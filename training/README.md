# Initial LoRA training

The first baseline uses [Qwen/Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B), a 0.6B-parameter causal language model published under Apache-2.0. It is a practical small Chinese-capable baseline; it is not assumed to solve Go by itself. The rules engine supplies verified board facts, and the model learns to explain them.

## Prepare

Python 3.10+ and a CUDA GPU are recommended.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r training/requirements.txt
```

Download or generate the train/validation JSONL files from the GitHub Actions artifact, then run:

```bash
python training/finetune_lora.py \
  --train data/processed/split/train.jsonl \
  --validation data/processed/split/validation.jsonl \
  --output-dir artifacts/weiqi-tutor-qwen3-0.6b-lora
```

Defaults are deliberately conservative: LoRA rank 8, 3 epochs, 2,048-token maximum, batch size 1 and gradient accumulation 8. Adjust batch size and accumulation to fit GPU memory.

## Evaluate the adapter

After training, evaluate on the puzzle-grouped held-out split:

```bash
python training/evaluate.py --adapter artifacts/weiqi-tutor-qwen3-0.6b-lora --data data/processed/split/validation.jsonl
```

The report includes branch-label accuracy, first-move top-1 hit rate, and JSON-format failures. These are task metrics, not a proof of Go strength; the move-policy metric only checks whether the model returns one of the verified source-labeled first moves.

## Important scope

This first adapter is a *verbalization baseline*: it is trained on rule-verified local facts and source-labeled correct/wrong branches. It is not a Go solver and does not prove whole-board life/death outcomes. Those require stronger tactical search and an independently curated evaluation set.

The training script masks system/user prompt tokens from the loss and trains on assistant responses only. Train/validation are grouped by stable puzzle ID, so sibling variations from one puzzle cannot leak across the split.
