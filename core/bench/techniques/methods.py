"""Retrieval techniques compared in the study, as score-matrix transforms."""

from collections import defaultdict
from pathlib import Path

import numpy as np

import harness as H
from retrieval_lexical import BM25, normalize, rescore_pool, tokens


def lexical_inputs():
    docs = [tokens(r["body"]) for r in H.CORPUS]
    qf = [tokens(c["query"], stop=True) for c in H.CASES]
    qd = [tokens(q["query"], stop=True) for q in H.DOC]
    return docs, qf, qd


def full_bm25(docs, queries):
    bm = BM25(docs)
    return np.array([bm.scores(q) for q in queries])


def rank_positions(scores):
    order = np.argsort(-scores, axis=1, kind="stable")
    out = np.empty_like(order)
    out[np.arange(len(scores))[:, None], order] = np.arange(scores.shape[1])[None, :]
    return out + 1


def rrf(dense, lexical, k=60, depth=100, lexical_weight=1.0):
    """Reciprocal rank fusion (Cormack et al. 2009) over each list's top `depth`."""
    fused = np.zeros(dense.shape)
    for weight, m in [(1.0, dense), (lexical_weight, lexical)]:
        r = rank_positions(m)
        fused += np.where(r <= depth, weight / (k + r), 0.0)
    return fused + 1e-9 * dense


def convex(dense, lexical, alpha):
    """Convex combination of per-query min-max-normalized scores (Bruch et al. 2023)."""
    return alpha * np.apply_along_axis(normalize, 1, dense) + (1 - alpha) * np.apply_along_axis(normalize, 1, lexical)


def rocchio(queries, docs, k, beta):
    """Vector pseudo-relevance feedback (Li et al. 2021): q + beta * mean(top-k)."""
    top = np.argsort(-(queries @ docs.T), axis=1)[:, :k]
    moved = queries + beta * docs[top].mean(1)
    return moved / np.linalg.norm(moved, axis=1, keepdims=True)


def pooled_hybrid(dense_f, dense_d, alpha=0.7, depth=64):
    docs, qf, qd = lexical_inputs()
    return rescore_pool(dense_f, docs, qf, alpha, depth), rescore_pool(dense_d, docs, qd, alpha, depth)


class CrossEncoder:
    def __init__(self, directory, onnx_name, max_length=512):
        import onnxruntime as ort
        from transformers import AutoTokenizer

        self.tok = AutoTokenizer.from_pretrained(directory, local_files_only=True)
        self.session = ort.InferenceSession(str(Path(directory) / onnx_name), providers=["CPUExecutionProvider"])
        self.names = {v.name for v in self.session.get_inputs()}
        self.max_length = max_length

    def score(self, query, docs, batch=8):
        out = []
        for s in range(0, len(docs), batch):
            enc = self.tok([query] * len(docs[s:s + batch]), docs[s:s + batch], padding=True,
                           truncation="only_second", max_length=self.max_length, return_tensors="np")
            logits = self.session.run(None, {n: enc[n].astype(np.int64) for n in self.names if n in enc})[0]
            out.extend(np.asarray(logits).reshape(len(logits), -1)[:, 0].tolist())
        return np.array(out)


def rerank(model, scores, queries, k, cache_path):
    """Reorder each query's top-k by cross-encoder score (Nogueira & Cho 2019).
    Scores are cached per (query, chunk) so first stages share them."""
    out = scores.astype(np.float64).copy()
    cache = np.load(cache_path, allow_pickle=True).item() if Path(cache_path).exists() else {}

    for i, query in enumerate(queries):
        top = np.argsort(-scores[i], kind="stable")[:k]
        missing = [int(t) for t in top if (query, int(t)) not in cache]
        for t, v in zip(missing, model.score(query, [H.CORPUS[t]["body"] for t in missing]) if missing else []):
            cache[(query, t)] = float(v)

        ce = np.array([cache[(query, int(t))] for t in top])
        base = scores[i, top].max() + 1000.0
        for position, j in enumerate(np.argsort(-ce, kind="stable")):
            out[i, top[j]] = base - position

        if i % 50 == 49:
            np.save(cache_path, cache, allow_pickle=True)

    np.save(cache_path, cache, allow_pickle=True)
    return out


MACRO, MARGIN = 2048, 128


def query_comment_lines():
    """path -> 0-based lines holding a doc-comment query (stripped for late chunking)."""
    lines = defaultdict(set)
    for q in H.DOC:
        row = H.CORPUS[q["index"]]
        text = (H.SNAP / row["path"]).read_text().split("\n")
        i = row["line"] - 2
        while i >= 0 and text[i].strip().startswith(("//", "/*", "*", "#")) and not text[i].strip().startswith("#include"):
            lines[row["path"]].add(i)
            i -= 1
    return lines


def file_token_states(model, text):
    """Token hidden states for a whole file in overlapping 2,048-token windows."""
    enc = model.tok(text, add_special_tokens=False, return_offsets_mapping=True)
    ids, offsets = enc["input_ids"], enc["offset_mapping"]
    hidden = np.zeros((len(ids), 768), dtype=np.float32)
    start, step = 0, MACRO - 2 - 2 * MARGIN

    while True:
        end = min(len(ids), start + MACRO - 2)
        window = [model.tok.cls_token_id] + ids[start:end] + [model.tok.sep_token_id]
        feed = {"input_ids": np.array([window], dtype=np.int64), "attention_mask": np.ones((1, len(window)), dtype=np.int64)}
        out = model.session.run(None, {k: v for k, v in feed.items() if k in model.names})[0][0, 1:-1]

        keep_from = 0 if start == 0 else MARGIN
        keep_to = len(out) if end == len(ids) else len(out) - MARGIN
        hidden[start + keep_from:start + keep_to] = out[keep_from:keep_to]
        if end == len(ids):
            return hidden, np.array([a for a, _ in offsets])
        start += step


def late_chunk_vectors(model):
    """Late chunking (Günther et al. 2024) with query comments removed from context."""
    strip, by_path = query_comment_lines(), defaultdict(list)
    for i, row in enumerate(H.CORPUS):
        by_path[row["path"]].append(i)

    vectors = np.zeros((len(H.CORPUS), 768), dtype=np.float32)
    for path, rows in by_path.items():
        if H.CORPUS[rows[0]]["category"] != "repository":
            for i in rows:
                vectors[i] = model.embed([H.CORPUS[i]["body"]], 8192)[0]
            continue

        kept, starts_of, ends_of, offset = [], {}, {}, 0
        for j, line in enumerate((H.SNAP / path).read_text().split("\n")):
            if j not in strip.get(path, ()):
                starts_of[j], ends_of[j] = offset, offset + len(line)
                kept.append(line)
                offset += len(line) + 1

        hidden, starts = file_token_states(model, "\n".join(kept))
        for i in rows:
            span = [j for j in range(H.CORPUS[i]["line"] - 1, H.CORPUS[i]["end_line"]) if j in starts_of]
            mask = (starts >= starts_of[span[0]]) & (starts < ends_of[span[-1]])
            v = hidden[mask].mean(0)
            vectors[i] = v / np.linalg.norm(v)
    return vectors
