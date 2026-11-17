"""Run code-search technique experiments: python run.py <experiment>...

Experiments: fusion prf windows precision rerank coderank late. Each prints
MRR per query set and paired-bootstrap ΔMRR (95% CI) against the
production-equivalent baseline (Jina int8, 256 tokens, dense only).
See docs/benchmarks/code-search-techniques-2026-11-17.md for setup.
"""

import sys

import numpy as np

import harness as H
import methods as M

DOCS, QF, QD = H.baseline()
BASE = H.evaluate(QF @ DOCS.T, QD @ DOCS.T)


def fusion():
    docs, qtf, qtd = M.lexical_inputs()
    lf, ld = M.full_bm25(docs, qtf), M.full_bm25(docs, qtd)
    sf, sd = QF @ DOCS.T, QD @ DOCS.T

    H.report("bm25 only", H.evaluate(lf, ld), BASE)
    H.report("rrf k=60", H.evaluate(M.rrf(sf, lf), M.rrf(sd, ld)), BASE)
    for alpha in (0.6, 0.7, 0.8, 0.9):
        H.report(f"convex full-corpus a={alpha}", H.evaluate(M.convex(sf, lf, alpha), M.convex(sd, ld, alpha)), BASE)
    for alpha in (0.6, 0.7, 0.8):
        H.report(f"pooled rescoring top64 a={alpha}", H.evaluate(*M.pooled_hybrid(sf, sd, alpha)), BASE)


def prf():
    for k, beta in ((3, 0.5), (5, 0.5), (3, 1.0), (10, 0.5)):
        qf, qd = M.rocchio(QF, DOCS, k, beta), M.rocchio(QD, DOCS, k, beta)
        H.report(f"rocchio k={k} beta={beta}", H.evaluate(qf @ DOCS.T, qd @ DOCS.T), BASE)


def windows():
    model = H.jina()
    for window in (512, 1024):
        docs = H.cached(f"d1_w{window}", lambda: model.embed([r["body"] for r in H.CORPUS], window))
        H.report(f"window {window}", H.evaluate(QF @ docs.T, QD @ docs.T), BASE)


def precision():
    model = H.Encoder(H.ROOT / "models/jina-fp32/model.onnx")
    docs = H.cached("fp32_d1_w256", lambda: model.embed([r["body"] for r in H.CORPUS], 256))
    qf = H.cached("fp32_q1_fixture", lambda: model.embed([c["query"] for c in H.CASES], 256))
    qd = H.cached("fp32_q1_doc", lambda: model.embed([q["query"] for q in H.DOC], 256))
    H.report("fp32 weights", H.evaluate(qf @ docs.T, qd @ docs.T), BASE)


def rerank():
    stages = {"dense": (QF @ DOCS.T, QD @ DOCS.T)}
    stages["hybrid"] = M.pooled_hybrid(*stages["dense"])
    hybrid = H.evaluate(*stages["hybrid"])
    queries = [c["query"] for c in H.CASES], [q["query"] for q in H.DOC]

    for name, onnx in (("rerank-jina-v2", "model_quantized.onnx"), ("rerank-mxbai-xs", "model_quantized.onnx")):
        model = M.CrossEncoder(H.ROOT / "models" / name, onnx)
        cache = H.CACHE / f"cepair_{name}.npy"
        for stage, (sf, sd) in stages.items():
            result = H.evaluate(M.rerank(model, sf, queries[0], 20, cache), M.rerank(model, sd, queries[1], 20, cache))
            H.report(f"{name} top20 over {stage}", result, BASE)
            if stage == "hybrid":
                H.report("  ... vs hybrid", result, hybrid)


def coderank():
    model = H.Encoder(H.ROOT / "models/coderankembed/model.onnx")
    prefix = "Represent this query for searching relevant code: "
    docs = H.cached("cre_d_w512", lambda: model.embed([r["body"] for r in H.CORPUS], 512))
    qf = H.cached("cre_q_fixture", lambda: model.embed([prefix + c["query"] for c in H.CASES], 512))
    qd = H.cached("cre_q_doc", lambda: model.embed([prefix + q["query"] for q in H.DOC], 512))

    dense = H.evaluate(qf @ docs.T, qd @ docs.T)
    H.report("CodeRankEmbed 512", dense, BASE)
    H.report("CodeRankEmbed + rescoring (vs itself)", H.evaluate(*M.pooled_hybrid(qf @ docs.T, qd @ docs.T)), dense)


def late():
    vectors = H.cached("d_late2048", lambda: M.late_chunk_vectors(H.jina()))
    H.report("late chunking", H.evaluate(QF @ vectors.T, QD @ vectors.T), BASE)
    w512 = np.load(H.CACHE / "d1_w512.npy")
    H.report("late chunking (vs window 512)", H.evaluate(QF @ vectors.T, QD @ vectors.T), H.evaluate(QF @ w512.T, QD @ w512.T))


if __name__ == "__main__":
    H.report("baseline", BASE)
    for name in sys.argv[1:]:
        globals()[name]()
