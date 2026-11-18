#!/usr/bin/env python3
"""Add hard negatives to train.jsonl using the base model's own mistakes.

    python mine_negatives.py --model ~/.codeberg/models/embeddinggemma-2 \\
        --data ~/ft-data --count 3

Writes train_mined.jsonl. Rows from Codeberg's learning export keep their
reviewed negatives. Spot-check a sample: some "negatives" may be correct.
"""

import argparse
from pathlib import Path

from encode import cached_embed, load_model, read_jsonl, write_jsonl
from negatives import choose_negatives


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--model", required=True, help="base model directory (or Hugging Face id)")
    p.add_argument("--data", type=Path, required=True, help="extract_pairs.py output directory")
    p.add_argument("--count", type=int, default=3, help="negatives per query")
    p.add_argument("--margin", type=float, default=0.95, help="keep candidates below margin * positive score")
    p.add_argument("--max-length", type=int, default=1024)
    args = p.parse_args()

    corpus = read_jsonl(args.data / "corpus.jsonl")
    for i, row in enumerate(corpus):
        row["index"] = i
    by_id = {row["id"]: row for row in corpus}

    train = read_jsonl(args.data / "train.jsonl")
    mine = [r for r in train if r["positive_id"] in by_id]

    model = load_model(args.model, args.max_length)
    cache = args.data / "cache"
    corpus_vecs = cached_embed(model, args.model, [r["text"] for r in corpus], False, cache, args.max_length)
    query_vecs = cached_embed(model, args.model, [r["query"] for r in mine], True, cache, args.max_length)

    for row, vec in zip(mine, query_vecs):
        picked = choose_negatives(vec, by_id[row["positive_id"]], corpus, corpus_vecs, args.count, args.margin)
        row["negatives"] = [corpus[i]["text"] for i in picked]

    write_jsonl(args.data / "train_mined.jsonl", train)
    with_negatives = sum(1 for r in train if r.get("negatives"))
    print(f"{with_negatives}/{len(train)} training rows have hard negatives -> {args.data / 'train_mined.jsonl'}")


if __name__ == "__main__":
    main()
