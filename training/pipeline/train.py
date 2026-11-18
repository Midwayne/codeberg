"""Fine-tune an embedding model on mined (query, code) pairs.

    python finetune.py train --model ~/.codeberg/models/embeddinggemma-2 \\
        --data ~/ft-data --output ~/ft-models/gemma-company

Contrastive training with in-batch and hard negatives (cached multiple
negatives ranking loss), using the model's own query/document prompts, in
FP32. Runs on Apple Silicon (MPS), CUDA or CPU.
"""

import json
from pathlib import Path

from .encode import load_model, prompts, read_jsonl


def datasets(rows, max_negatives):
    """Triplets where a hard negative exists, plain pairs otherwise."""
    from datasets import Dataset

    triplets, pairs = [], []
    for r in rows:
        for negative in (r.get("negatives") or [])[:max_negatives]:
            triplets.append({"anchor": r["query"], "positive": r["positive"], "negative": negative})
        if not r.get("negatives"):
            pairs.append({"anchor": r["query"], "positive": r["positive"]})

    out = {}
    if triplets:
        out["triplets"] = Dataset.from_list(triplets)
    if pairs:
        out["pairs"] = Dataset.from_list(pairs)
    return out


def add_arguments(p):
    p.add_argument("--model", required=True)
    p.add_argument("--data", type=Path, required=True, help="directory with train_mined.jsonl (or train.jsonl)")
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--epochs", type=float, default=1.0)
    p.add_argument("--learning-rate", type=float, default=2e-5)
    p.add_argument("--batch-size", type=int, default=32, help="in-batch negatives per step; larger is better")
    p.add_argument("--mini-batch-size", type=int, default=4, help="lower this if memory runs out")
    p.add_argument("--max-length", type=int, default=1024)
    p.add_argument("--max-negatives", type=int, default=1)
    p.add_argument("--seed", type=int, default=42)


def run(args):
    from sentence_transformers import SentenceTransformerTrainer, SentenceTransformerTrainingArguments
    try:  # sentence-transformers 6.1+
        from sentence_transformers.sentence_transformer.losses import CachedMultipleNegativesRankingLoss
        from sentence_transformers.sentence_transformer.training_args import BatchSamplers
    except ImportError:
        from sentence_transformers.losses import CachedMultipleNegativesRankingLoss
        from sentence_transformers.training_args import BatchSamplers

    source = args.data / "train_mined.jsonl"
    rows = read_jsonl(source if source.exists() else args.data / "train.jsonl")

    model = load_model(args.model, args.max_length)
    query_prompt, document_prompt = prompts(model)
    data = datasets(rows, args.max_negatives)

    training = SentenceTransformerTrainingArguments(
        output_dir=str(args.output / "checkpoints"), num_train_epochs=args.epochs,
        learning_rate=args.learning_rate, per_device_train_batch_size=args.batch_size,
        warmup_ratio=0.1, seed=args.seed, logging_steps=10, save_strategy="no", report_to="none",
        batch_sampler=BatchSamplers.NO_DUPLICATES,  # duplicates would become false negatives
        prompts={"anchor": query_prompt, "positive": document_prompt, "negative": document_prompt})

    loss = CachedMultipleNegativesRankingLoss(model, mini_batch_size=args.mini_batch_size)
    SentenceTransformerTrainer(model=model, args=training, train_dataset=data, loss=loss).train()

    args.output.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(args.output))
    meta = {"base_model": str(args.model), "rows": len(rows), "examples": {k: len(v) for k, v in data.items()},
            "args": {k: str(v) for k, v in vars(args).items()}}
    (args.output / "codeberg_finetune.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"saved {args.output}")

