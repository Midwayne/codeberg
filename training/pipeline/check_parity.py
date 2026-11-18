"""Confirm the MLX export embeds exactly like the trained model.

    python finetune.py check-parity --model ~/ft-models/gemma-company --mlx ~/ft-models/gemma-company-mlx

Exits non-zero if any probe's cosine similarity is below --threshold. A failure
means the conversion lost or renamed weights (or prompts differ): do not deploy.
"""

from pathlib import Path
import sys

import numpy as np

from .encode import embed, load_model
from .probes import DOCUMENTS, QUERIES


def cosines(a, b):
    a = a / np.linalg.norm(a, axis=1, keepdims=True)
    b = b / np.linalg.norm(b, axis=1, keepdims=True)
    return (a * b).sum(axis=1)


def add_arguments(p):
    p.add_argument("--model", type=Path, required=True, help="output of the train step")
    p.add_argument("--mlx", type=Path, required=True, help="output of the export-mlx step")
    p.add_argument("--threshold", type=float, default=0.999)


def run(args):
    model = load_model(args.model, 8192)
    reference = np.vstack([embed(model, QUERIES, query=True), embed(model, DOCUMENTS, query=False)])
    converted = np.load(args.mlx / "parity_probes.npy")

    sims = cosines(reference, converted)
    print("probe cosine similarity:", " ".join(f"{s:.5f}" for s in sims))
    if sims.min() < args.threshold:
        print(f"FAIL: minimum {sims.min():.5f} < {args.threshold}; do not deploy this export")
        sys.exit(1)
    print("OK: the MLX export matches the trained model")

