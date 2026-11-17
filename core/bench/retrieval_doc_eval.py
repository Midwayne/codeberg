"""Doc-comment -> function retrieval over one or more generated corpora.

Each production function with a doc comment directly above it (at least six
words) contributes a query: that comment. Comments sit outside chunk spans, so
the embedded body never contains its own query. The function's name is masked
so a symbol line in a location header cannot match it lexically.

Queries come from the first corpus; every corpus must share its row order,
which retrieval_corpus.py guarantees across --header styles.
"""

import argparse
import json
from pathlib import Path
import re

import numpy as np

from retrieval_client import Worker, embed_corpus

COMMENT_MARKER = re.compile(r"^\s*(//+|/\*+|\*+/?|#)\s?")
MIN_WORDS = 6


def leading_comment(root, row):
    lines = (root / row["path"]).read_text().split("\n")
    collected = []
    i = row["line"] - 2

    while i >= 0:
        text = lines[i].strip()
        if not text.startswith(("//", "/*", "*", "#")) or text.startswith("#include"):
            break

        collected.insert(0, COMMENT_MARKER.sub("", text).rstrip("*/ ").strip())
        i -= 1

    return " ".join(part for part in collected if part)


def build_queries(root, corpus):
    queries = []
    for index, row in enumerate(corpus):
        if row["category"] != "repository":
            continue

        text = leading_comment(root, row)
        name = row["symbol"].split(".")[-1]
        if name:
            text = re.sub(rf"\b{re.escape(name)}\b", "this function", text)

        if len(text.split()) >= MIN_WORDS:
            queries.append({"index": index, "query": text, "path": row["path"]})
    return queries


def gold_ranks(documents, vectors, queries):
    scores = vectors @ documents.T
    gold = np.array([q["index"] for q in queries])
    gold_scores = scores[np.arange(len(queries)), gold]

    return (scores > gold_scores[:, None]).sum(axis=1) + 1


def summarize(ranks):
    return {"hit_at_1": float(np.mean(ranks <= 1)), "hit_at_5": float(np.mean(ranks <= 5)),
            "hit_at_10": float(np.mean(ranks <= 10)), "mrr": float(np.mean(1 / ranks))}


def evaluate(backend, model, corpus_path, queries, log):
    corpus = json.loads(corpus_path.read_text())
    worker = Worker(backend, model, log)
    try:
        documents, _ = embed_corpus(worker, corpus)
        vectors, _ = worker.embed([q["query"] for q in queries], query=True)
    finally:
        worker.close()

    return gold_ranks(documents, vectors, queries)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--backend", required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, action="append", required=True,
                        help="corpus.json; repeat to compare variants")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    first = json.loads(args.corpus[0].read_text())
    queries = build_queries(args.root.resolve(), first)
    print(f"{len(queries)} doc-comment queries", flush=True)

    results = {}
    for corpus_path in args.corpus:
        name = corpus_path.parent.name
        ranks = evaluate(args.backend, args.model.resolve(), corpus_path, queries,
                         args.output.with_suffix(f".{name}.log"))
        results[name] = {"metrics": summarize(ranks), "ranks": ranks.tolist()}
        print(name, json.dumps(results[name]["metrics"]), flush=True)

    args.output.write_text(json.dumps({"queries": queries, "results": results}, indent=2) + "\n")


if __name__ == "__main__":
    main()
