#!/usr/bin/env python3
"""Evaluate a trained Weiqi Tutor LoRA adapter on held-out puzzle IDs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import torch
from peft import AutoPeftModelForCausalLM
from transformers import AutoTokenizer


def parse_json_object(text: str) -> dict[str, Any] | None:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        value = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def move_key(move: dict[str, Any]) -> tuple[Any, Any, Any]:
    return move.get("color"), move.get("x"), move.get("y")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--max-new-tokens", type=int, default=256)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    tokenizer = AutoTokenizer.from_pretrained(args.adapter)
    model = AutoPeftModelForCausalLM.from_pretrained(
        args.adapter,
        torch_dtype="auto",
        device_map="auto",
    )
    model.eval()

    rows = [
        json.loads(line)
        for line in args.data.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if args.limit > 0:
        rows = rows[: args.limit]

    branch_total = branch_correct = 0
    policy_total = policy_correct = 0
    parse_errors = 0

    for index, sample in enumerate(rows, 1):
        messages = sample["messages"][:-1]
        encoded = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
            return_dict=True,
        )
        encoded = {key: value.to(model.device) for key, value in encoded.items()}
        with torch.inference_mode():
            generated = model.generate(
                **encoded,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
            )
        prompt_length = encoded["input_ids"].shape[-1]
        response = tokenizer.decode(
            generated[0][prompt_length:],
            skip_special_tokens=True,
        )
        prediction = parse_json_object(response)
        if prediction is None:
            parse_errors += 1
            continue

        if sample.get("taskType") == "first-move-policy":
            policy_total += 1
            expected = {
                move_key(move)
                for move in sample["target"].get("recommendedMoves", [])
            }
            predicted = prediction.get("recommendedMoves", [])
            predicted_keys = {
                move_key(move)
                for move in predicted
                if isinstance(move, dict)
            }
            if expected.intersection(predicted_keys):
                policy_correct += 1
        else:
            branch_total += 1
            expected_label = sample.get("target", {}).get("verdict")
            predicted_label = prediction.get("verdict")
            if predicted_label == expected_label:
                branch_correct += 1

        if index % 50 == 0:
            print(f"Evaluated {index}/{len(rows)} samples")

    result = {
        "samples": len(rows),
        "branch": {
            "correct": branch_correct,
            "total": branch_total,
            "accuracy": branch_correct / branch_total if branch_total else None,
        },
        "firstMovePolicy": {
            "correct": policy_correct,
            "total": policy_total,
            "top1HitRate": policy_correct / policy_total if policy_total else None,
        },
        "jsonParseErrors": parse_errors,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
