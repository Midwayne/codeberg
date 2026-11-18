"""Convert a fine-tuned EmbeddingGemma 2 checkpoint for Codeberg's MLX runtime.

Run with Codeberg's MLX environment (Apple Silicon):

    ~/.codeberg/embeddinggemma-mlx-venv/bin/python finetune.py export-mlx \\
        --model ~/ft-models/gemma-company --output ~/ft-models/gemma-company-mlx

Uses the same conversion as Codeberg's own setup, then embeds fixed probe texts
into <output>/parity_probes.npy. Run the check-parity step next: deploy only if it passes.
"""

from pathlib import Path
import sys

import numpy as np

# Codeberg's own MLX adapter (scripts/embedding_gemma_mlx.py), so the conversion
# matches what Codeberg runs at search time.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from .probes import DOCUMENTS, QUERIES  # noqa: E402


def add_arguments(p):
    p.add_argument("--model", type=Path, required=True, help="output directory of the train step")
    p.add_argument("--output", type=Path, required=True)


def run(args):
    from embedding_gemma_mlx import embedder, prepare

    prepare(str(args.model), str(args.output))
    embed, stop = embedder(str(args.output))
    try:
        vectors = np.array(embed(QUERIES, query=True) + embed(DOCUMENTS, query=False), dtype=np.float32)
    finally:
        stop()

    np.save(args.output / "parity_probes.npy", vectors)
    print(f"converted to {args.output}; probe vectors saved. Next: finetune.py check-parity")

