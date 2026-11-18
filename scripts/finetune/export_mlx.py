#!/usr/bin/env python3
"""Convert a fine-tuned EmbeddingGemma 2 checkpoint for Codeberg's MLX runtime.

Run with Codeberg's MLX environment (Apple Silicon):

    ~/.codeberg/embeddinggemma-mlx-venv/bin/python export_mlx.py \\
        --model ~/ft-models/gemma-company --output ~/ft-models/gemma-company-mlx

Uses the same conversion as Codeberg's own setup, then embeds fixed probe texts
into <output>/parity_probes.npy. Run check_parity.py next: deploy only if it passes.
"""

import argparse
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # scripts/: Codeberg's MLX adapter

from probes import DOCUMENTS, QUERIES  # noqa: E402


def main():
    from embedding_gemma_mlx import embedder, prepare

    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", type=Path, required=True, help="train.py output directory")
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()

    prepare(str(args.model), str(args.output))
    embed, stop = embedder(str(args.output))
    try:
        vectors = np.array(embed(QUERIES, query=True) + embed(DOCUMENTS, query=False), dtype=np.float32)
    finally:
        stop()

    np.save(args.output / "parity_probes.npy", vectors)
    print(f"converted to {args.output}; probe vectors saved. Next: check_parity.py")


if __name__ == "__main__":
    main()
