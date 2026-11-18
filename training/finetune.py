#!/usr/bin/env python3
"""Fine-tune Codeberg's search embedding model (EmbeddingGemma 2) on your code.

Optional and standalone: nothing here runs as part of Codeberg. Steps, in order:

    extract       code + docs -> corpus.jsonl, train.jsonl, eval.jsonl
    mine          add hard negatives from the base model's mistakes
    train         fine-tune with contrastive loss
    evaluate      compare models on held-out queries
    export-mlx    convert for Codeberg on Apple Silicon (run with the MLX venv)
    check-parity  confirm the export embeds exactly like the trained model

See training/README.md. Run `python finetune.py <step> --help` for a step's options.
"""

import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline import (check_parity, evaluate, export_mlx, extract_pairs,  # noqa: E402
                      mine_negatives, train)

STEPS = {
    "extract": extract_pairs,
    "mine": mine_negatives,
    "train": train,
    "evaluate": evaluate,
    "export-mlx": export_mlx,
    "check-parity": check_parity,
}


def parser():
    root = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    steps = root.add_subparsers(dest="step", required=True, metavar="STEP")

    for name, module in STEPS.items():
        summary = (module.__doc__ or "").strip().split("\n")[0]
        step = steps.add_parser(name, help=summary, description=module.__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
        module.add_arguments(step)
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    STEPS[args.step].run(args)


if __name__ == "__main__":
    main()
