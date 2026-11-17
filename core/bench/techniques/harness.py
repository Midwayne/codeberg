"""Shared harness for the code-search technique study.

Embeds in-process with ONNX Runtime (masked mean pooling, L2 norm, batch size 1
so int8 dynamic quantization cannot couple unrelated texts), caches vectors
under <work>/exp, and scores two query sets: the hard fixture from
retrieval_corpus.py and doc-comment queries from retrieval_doc_eval.py.

Source files are read from <work>/snapshot, a worktree at the corpus commit,
so working-tree edits cannot shift chunk bodies mid-study.
"""

import json
import os
from pathlib import Path
import sys

import numpy as np

BENCH = Path(__file__).resolve().parents[1]
ROOT = BENCH.parents[1]
WORK = Path(os.environ.get("CBERG_TECHNIQUES_WORK", ROOT / "build/embedding-benchmark"))
CACHE = WORK / "exp"
SNAP = WORK / "snapshot"
sys.path.insert(0, str(BENCH))

from retrieval_doc_eval import build_queries  # noqa: E402

CORPUS = json.loads((WORK / "hdr-none/corpus.json").read_text())
CASES = json.loads((WORK / "hdr-none/cases.json").read_text())
DOC = build_queries(SNAP, CORPUS)
ID_INDEX = {row["id"]: i for i, row in enumerate(CORPUS)}
CATEGORIES = np.array([c["category"] for c in CASES])


class Encoder:
    """Mean-pooled ONNX encoder (Jina v2 code, CodeRankEmbed, ...)."""

    def __init__(self, path):
        import onnxruntime as ort
        from transformers import AutoTokenizer

        self.tok = AutoTokenizer.from_pretrained(Path(path).parent, local_files_only=True)
        self.session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        self.names = {v.name for v in self.session.get_inputs()}

    def embed(self, texts, max_length=256):
        out = np.zeros((len(texts), 768), dtype=np.float32)
        for i, text in enumerate(texts):
            inputs = self.tok([text], truncation=True, max_length=max_length, return_tensors="np")
            hidden = self.session.run(None, {n: inputs[n].astype(np.int64) for n in self.names})[0]
            pooled = hidden[0].mean(0)
            out[i] = pooled / np.linalg.norm(pooled)
        return out


def jina():
    return Encoder(ROOT / "models/jina-embeddings-v2-base-code/model.onnx")


def cached(name, fn):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{name}.npy"
    if path.exists():
        return np.load(path)

    value = fn()
    np.save(path, value)
    return value


def baseline():
    """Production-equivalent Jina vectors (256 tokens) and query vectors."""
    model = None

    def encoder():
        nonlocal model
        model = model or jina()
        return model

    docs = cached("d1_w256", lambda: encoder().embed([r["body"] for r in CORPUS], 256))
    qf = cached("q1_fixture", lambda: encoder().embed([c["query"] for c in CASES], 256))
    qd = cached("q1_doc", lambda: encoder().embed([q["query"] for q in DOC], 256))
    return docs, qf, qd


def ranks(scores, gold_sets):
    """1-based rank of each query's best gold item."""
    return np.array([int((row > max(row[g] for g in gold)).sum()) + 1 for row, gold in zip(scores, gold_sets)])


def evaluate(s_fixture, s_doc):
    fixture_gold = [[ID_INDEX[r] for r in c["relevant"]] for c in CASES]
    fr = ranks(s_fixture, fixture_gold)
    dr = ranks(s_doc, [[q["index"]] for q in DOC])

    summary = {}
    for name, r in [("repo", fr[CATEGORIES == "repository"]), ("pairs", fr[CATEGORIES == "minimal_pairs"]),
                    ("long", fr[CATEGORIES == "long_context"]), ("doc", dr)]:
        summary[name] = {"h1": float(np.mean(r <= 1)), "h10": float(np.mean(r <= 10)), "mrr": float(np.mean(1 / r))}
    return {"fixture_ranks": fr, "doc_ranks": dr, "summary": summary}


def bootstrap(base, new, n=10000, seed=0):
    diff = 1 / new - 1 / base
    idx = np.random.default_rng(seed).integers(0, len(diff), (n, len(diff)))
    means = diff[idx].mean(1)
    return float(diff.mean()), float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def report(name, result, base=None):
    s = result["summary"]
    line = (f"{name:34} repo {s['repo']['mrr']:.3f} | pairs {s['pairs']['mrr']:.3f} | "
            f"long {s['long']['mrr']:.3f} | doc {s['doc']['mrr']:.3f}")

    if base is not None:
        repo = CATEGORIES == "repository"
        r = bootstrap(base["fixture_ranks"][repo], result["fixture_ranks"][repo])
        d = bootstrap(base["doc_ranks"], result["doc_ranks"])
        line += f"\n{'':34} Δrepo {r[0]:+.3f} [{r[1]:+.3f},{r[2]:+.3f}]  Δdoc {d[0]:+.4f} [{d[1]:+.4f},{d[2]:+.4f}]"

    print(line, flush=True)
