"""Reproducible hard retrieval and steady-state timing benchmark."""

import argparse
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import platform
import random
import statistics
import time

import numpy as np

from retrieval_client import Worker, embed_corpus
from retrieval_metrics import rank_queries, summarize


def evaluate(worker, corpus, cases, documents, instruct=False):
    queries = []
    for case in cases:
        vector, _ = worker.embed([case["query"]], query=True, instruct=instruct)
        queries.append(vector[0])
    queries = np.array(queries, dtype=np.float32)
    started = time.perf_counter()
    rows = rank_queries(documents, queries, cases, corpus)
    ranking_ms = (time.perf_counter() - started) * 1000 / len(cases)
    groups = {name: summarize([row for row in rows if row["category"] == name])
              for name in sorted({row["category"] for row in rows})}
    return rows, {"overall": summarize(rows), "categories": groups}, queries, ranking_ms


def query_timings(worker, cases, trials, instruct=False):
    timings = []
    trial_medians = []
    for trial in range(trials):
        order = list(range(len(cases)))
        random.Random(8719 + trial).shuffle(order)
        values = [worker.embed([cases[index]["query"]], query=True, instruct=instruct)[1] * 1000
                  for index in order]
        timings.extend(values)
        trial_medians.append(statistics.median(values))
    return {"median_ms": statistics.median(timings), "p95_ms": float(np.percentile(timings, 95)),
            "trials_ms": trial_medians, "requests": len(timings)}


def token_stats(model, backend, corpus):
    from transformers import AutoTokenizer

    directory = model.parent if model.is_file() else model
    tokenizer = AutoTokenizer.from_pretrained(directory, local_files_only=True)
    limit = 256 if backend == "jina-onnx" else 512 if backend == "mlx" else 8192
    prefix = "title: none | text: " if backend in ("gemma-mlx", "sentence-transformers") else ""
    lengths = [len(tokenizer(prefix + row["body"])["input_ids"]) for row in corpus]
    return {"limit": limit, "p50": float(np.percentile(lengths, 50)),
            "p95": float(np.percentile(lengths, 95)), "max": max(lengths),
            "truncated_documents": sum(length > limit for length in lengths),
            "long_fixture_tokens": [length for row, length in zip(corpus, lengths)
                                    if row["category"] == "long_context"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--trials", type=int, default=5)
    args = parser.parse_args()
    corpus, cases = json.loads(args.corpus.read_text()), json.loads(args.cases.read_text())
    worker = Worker(args.backend, args.model.resolve(), args.output.with_suffix(".worker.log"))
    try:
        print(f"loaded {args.backend}: {worker.dimension}d in {worker.load_seconds:.2f}s", flush=True)
        documents, cold_seconds = embed_corpus(worker, corpus, progress=True)
        rows, metrics, queries, ranking_ms = evaluate(worker, corpus, cases, documents)
        print(json.dumps(metrics), flush=True)

        # Fixed quantiles of production body lengths avoid favoring short rows.
        production = sorted([row for row in corpus if row["category"] == "repository"],
                            key=lambda row: len(row["body"].encode()))
        sample = [production[int(index)] for index in np.linspace(0, len(production) - 1, 256)]
        embed_corpus(worker, sample)  # warm up; excluded from timing
        trial_seconds = []
        for trial in range(args.trials):
            trial_seconds.append(embed_corpus(worker, sample)[1])
            print(f"throughput trial {trial + 1}/{args.trials}: {trial_seconds[-1]:.3f}s", flush=True)
        print('throughput trials:', trial_seconds, flush=True)
        latency = query_timings(worker, cases, args.trials)
        result = {"backend": args.backend, "model_path": str(args.model.resolve()),
                  "dimension": worker.dimension, "model_load_seconds": worker.load_seconds,
                  "corpus_embedding_seconds": cold_seconds, "metrics": metrics, "cases": rows,
                  "query_latency": latency, "exact_rank_ms_per_query": ranking_ms,
                  "throughput": {"sample_chunks": len(sample), "trial_seconds": trial_seconds,
                                 "median_chunks_per_second": len(sample) / statistics.median(trial_seconds)},
                  "tokens": token_stats(args.model.resolve(), args.backend, corpus),
                  "corpus_sha256": hashlib.sha256(args.corpus.read_bytes()).hexdigest(),
                  "cases_sha256": hashlib.sha256(args.cases.read_bytes()).hexdigest(),
                  "system": {"platform": platform.platform(), "python": platform.python_version()},
                  "versions": {name: version(name) for name in ("mlx", "mlx-vlm", "mlx-embeddings",
                              "torch", "transformers", "sentence-transformers", "onnxruntime")}}
        np.savez(args.output.with_suffix(".vectors.npz"), documents=documents, queries=queries)
        if args.backend == "mlx":
            reference_rows, reference_metrics, _, _ = evaluate(worker, corpus, cases, documents, instruct=True)
            result["qwen_instruction_reference"] = {"metrics": reference_metrics, "cases": reference_rows,
                "query_latency": query_timings(worker, cases, args.trials, instruct=True)}
    finally:
        peak = worker.close()
    result["peak_rss_bytes"] = peak
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"saved {args.output}; median query {latency['median_ms']:.2f}ms", flush=True)


if __name__ == "__main__":
    main()
