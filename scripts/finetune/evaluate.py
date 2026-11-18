#!/usr/bin/env python3
"""Compare embedding models on held-out queries; the first model is the baseline.

    python evaluate.py --data ~/ft-data \\
        --model base=~/.codeberg/models/embeddinggemma-2 --model tuned=~/ft-models/gemma-company \\
        [--queries ~/ft-data/real-questions.jsonl]

Each query ranks against every chunk in corpus.jsonl. Reports MRR and hit@k
per source, and ΔMRR with a 95% paired-bootstrap interval. Adopt the tuned
model only when every interval you care about lies above zero.

--queries adds hand-written questions: {"query": ..., "positive_ids": [corpus ids]}.
"""

import argparse
import json
from pathlib import Path

import numpy as np

from encode import cached_embed, load_model, read_jsonl
from metrics import gold_ranks, paired_bootstrap, summarize


def query_sets(data, extra):
    sets = {}
    for row in read_jsonl(data / "eval.jsonl"):
        sets.setdefault(row["source"], []).append({"query": row["query"], "positive_ids": [row["positive_id"]]})
    if extra:
        sets["real_questions"] = read_jsonl(extra)
    return sets


def rank_all(model, path, corpus, sets, ids, cache, max_length):
    corpus_vecs = cached_embed(model, path, [r["text"] for r in corpus], False, cache, max_length)
    out = {}
    for name, rows in sets.items():
        rows = [r for r in rows if all(i in ids for i in r["positive_ids"])]
        if not rows:
            continue
        query_vecs = cached_embed(model, path, [r["query"] for r in rows], True, cache, max_length)
        out[name] = gold_ranks(query_vecs @ corpus_vecs.T, [[ids[i] for i in r["positive_ids"]] for r in rows])
    out["all"] = np.concatenate(list(out.values()))
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--model", action="append", required=True, metavar="NAME=PATH")
    p.add_argument("--queries", type=Path, help="optional hand-written questions (JSONL)")
    p.add_argument("--max-length", type=int, default=2048)
    p.add_argument("--output", type=Path, help="write the report as JSON")
    args = p.parse_args()

    corpus = read_jsonl(args.data / "corpus.jsonl")
    ids = {r["id"]: i for i, r in enumerate(corpus)}
    sets = query_sets(args.data, args.queries)

    results, report = {}, {}
    for spec in args.model:
        name, _, path = spec.partition("=")
        model = load_model(path, args.max_length)
        results[name] = rank_all(model, path, corpus, sets, ids, args.data / "cache", args.max_length)
        report[name] = {s: summarize(r) for s, r in results[name].items()}
        del model

    base = args.model[0].partition("=")[0]
    for name in list(results)[1:]:
        report[f"{name}_vs_{base}"] = {s: paired_bootstrap(results[base][s], results[name][s]) for s in results[name]}

    text = json.dumps(report, indent=2)
    print(text)
    if args.output:
        args.output.write_text(text + "\n")


if __name__ == "__main__":
    main()
