#!/usr/bin/env python3
"""LoRA fine-tuning for Weiqi Tutor chat-message JSONL samples."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import torch
from peft import LoraConfig, TaskType, get_peft_model
from torch.utils.data import Dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
)


class ChatJsonlDataset(Dataset):
    def __init__(self, path: Path, tokenizer: Any, max_length: int) -> None:
        self.rows: list[dict[str, list[int]]] = []
        skipped = 0
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            sample = json.loads(line)
            messages = sample.get("messages")
            if not isinstance(messages, list) or len(messages) != 3:
                raise ValueError(f"{path}:{line_number}: expected system/user/assistant messages")
            if [message.get("role") for message in messages] != ["system", "user", "assistant"]:
                raise ValueError(f"{path}:{line_number}: invalid message role order")

            prompt_ids = tokenizer.apply_chat_template(
                messages[:-1],
                tokenize=True,
                add_generation_prompt=True,
            )
            full_ids = tokenizer.apply_chat_template(
                messages,
                tokenize=True,
                add_generation_prompt=False,
            )
            if full_ids[: len(prompt_ids)] != prompt_ids:
                raise ValueError(
                    f"{path}:{line_number}: chat template prefix mismatch; "
                    "cannot safely mask prompt tokens"
                )
            if len(full_ids) > max_length:
                skipped += 1
                continue

            labels = [-100] * len(prompt_ids) + full_ids[len(prompt_ids) :]
            if all(label == -100 for label in labels):
                skipped += 1
                continue
            self.rows.append({
                "input_ids": full_ids,
                "attention_mask": [1] * len(full_ids),
                "labels": labels,
            })
        if not self.rows:
            raise ValueError(f"No usable training samples found in {path}")
        print(f"{path}: {len(self.rows)} samples loaded; {skipped} skipped")

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int) -> dict[str, list[int]]:
        return self.rows[index]


class ChatCollator:
    def __init__(self, pad_token_id: int) -> None:
        self.pad_token_id = pad_token_id

    def __call__(self, features: list[dict[str, list[int]]]) -> dict[str, torch.Tensor]:
        max_length = max(len(item["input_ids"]) for item in features)
        input_ids, attention_masks, labels = [], [], []
        for item in features:
            padding = max_length - len(item["input_ids"])
            input_ids.append(item["input_ids"] + [self.pad_token_id] * padding)
            attention_masks.append(item["attention_mask"] + [0] * padding)
            labels.append(item["labels"] + [-100] * padding)
        return {
            "input_ids": torch.tensor(input_ids, dtype=torch.long),
            "attention_mask": torch.tensor(attention_masks, dtype=torch.long),
            "labels": torch.tensor(labels, dtype=torch.long),
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model", default="Qwen/Qwen3-0.6B")
    parser.add_argument("--max-length", type=int, default=2048)
    parser.add_argument("--epochs", type=float, default=3)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--lora-rank", type=int, default=8)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--allow-cpu", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not torch.cuda.is_available() and not args.allow_cpu:
        raise RuntimeError(
            "A CUDA GPU is required for practical LoRA training. "
            "Pass --allow-cpu only for a very slow smoke run."
        )

    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)
        dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
    else:
        dtype = torch.float32

    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=False)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    train_data = ChatJsonlDataset(args.train, tokenizer, args.max_length)
    validation_data = ChatJsonlDataset(args.validation, tokenizer, args.max_length)

    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        torch_dtype=dtype,
        low_cpu_mem_usage=True,
        trust_remote_code=False,
    )
    model.config.use_cache = False
    model.gradient_checkpointing_enable()
    model.enable_input_require_grads()

    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=args.lora_rank,
        lora_alpha=args.lora_rank * 2,
        lora_dropout=0.05,
        bias="none",
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    training_args = TrainingArguments(
        output_dir=str(args.output_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation,
        learning_rate=args.learning_rate,
        weight_decay=0.01,
        warmup_ratio=0.05,
        lr_scheduler_type="cosine",
        logging_steps=5,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=2,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        bf16=dtype == torch.bfloat16,
        fp16=dtype == torch.float16,
        gradient_checkpointing=True,
        optim="adamw_torch",
        report_to="none",
        remove_unused_columns=False,
        dataloader_num_workers=2,
        seed=args.seed,
        data_seed=args.seed,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_data,
        eval_dataset=validation_data,
        data_collator=ChatCollator(tokenizer.pad_token_id),
    )
    trainer.train()
    trainer.save_model(str(args.output_dir))
    tokenizer.save_pretrained(str(args.output_dir))
    trainer.save_metrics("train", trainer.state.log_history[-1])
    print(f"LoRA adapter saved to {args.output_dir}")


if __name__ == "__main__":
    main()
