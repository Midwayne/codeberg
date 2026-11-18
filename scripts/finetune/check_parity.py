#!/usr/bin/env python3
"""Confirm the MLX export embeds exactly like the trained model.

    python check_parity.py --model ~/ft-models/gemma-company --mlx ~/ft-models/gemma-company-mlx

Exits non-zero if any probe's cosine similarity is below --threshold. A failure
means the conversion lost or renamed weights (or prompts differ): do not deploy.
"""

import argparse
from pathlib import Path
import sys

import numpy as np

from encode import embed, load_model
from probes import DOCUMENTS, QUERIES


def cosines(a, b):
    a = a / np.linalg.norm(a, axis=1, keepdims=True)
    b = b / np.linalg.norm(b, axis=1, keepdims=True)
    return (a * b).sum(axis=1)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", type=Path, required=True, help="train.py output (Sentence Transformers)")
    p.add_argument("--mlx", type=Path, required=True, help="export_mlx.py output")
    p.add_argument("--threshold", type=float, default=0.999)
    args = p.parse_args()

    model = load_model(args.model, 8192)
    reference = np.vstack([embed(model, QUERIES, query=True), embed(model, DOCUMENTS, query=False)])
    converted = np.load(args.mlx / "parity_probes.npy")

    sims = cosines(reference, converted)
    print("probe cosine similarity:", " ".join(f"{s:.5f}" for s in sims))
    if sims.min() < args.threshold:
        print(f"FAIL: minimum {sims.min():.5f} < {args.threshold}; do not deploy this export")
        sys.exit(1)
    print("OK: the MLX export matches the trained model")


if __name__ == "__main__":
    main()
