"""Code-aware BM25 rescoring of a dense candidate pool.

This is the reference for the daemon's search rescoring
(daemon/internal/search/{tokens,bm25,rescore}.go); both must rank a pool
identically. See docs/benchmarks/code-search-techniques-2026-11-17.md.
"""

import math
import re
from collections import Counter

import numpy as np

STOP = set("""a an and are as at be by can do does for from has have how i if in into is it its
of on or that the their then this to was what when where which while who why will with
find locate retrieve where's whose there them they should must only not no up out than
so such these those via per each every any all both after before during""".split())

WORD = re.compile(r"[A-Za-z0-9]+")
CAMEL = re.compile(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+")

POOL = 64
DENSE_WEIGHT = 0.7


def tokens(text, stop=False):
    """Lowercased words, with camelCase/snake_case parts plus the whole identifier."""
    out = []
    for word in WORD.findall(text):
        parts = CAMEL.findall(word)
        if len(parts) > 1:
            out.append(word.lower())
        out.extend(p.lower() for p in parts)

    if stop:
        out = [t for t in out if t not in STOP and len(t) > 1]
    return out


class BM25:
    def __init__(self, docs, k1=1.2, b=0.75):
        self.k1, self.b = k1, b
        self.tf = [Counter(d) for d in docs]
        self.len = np.array([len(d) for d in docs], dtype=np.float64)
        self.avg = max(self.len.mean(), 1.0)

        df = Counter()
        for counts in self.tf:
            df.update(counts.keys())

        n = len(docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def scores(self, query_tokens):
        out = np.zeros(len(self.tf))
        norm = self.k1 * (1 - self.b + self.b * self.len / self.avg)

        for t in set(query_tokens):
            if t not in self.idf:
                continue
            f = np.array([counts.get(t, 0) for counts in self.tf], dtype=np.float64)
            out += self.idf[t] * f * (self.k1 + 1) / (f + norm)
        return out


def normalize(v):
    lo, hi = v.min(), v.max()
    return (v - lo) / (hi - lo) if hi > lo else np.zeros_like(v)


def rescore_pool(dense, docs_tokens, query_tokens_list, alpha=DENSE_WEIGHT, depth=POOL):
    """Reorder each query's dense top-`depth` by alpha*dense + (1-alpha)*BM25,
    both min-max normalized over the pool, with pool-local idf. Chunks outside
    the pool keep their dense order below it."""
    out = dense.astype(np.float64) - 10.0
    for i, qt in enumerate(query_tokens_list):
        top = np.argsort(-dense[i], kind="stable")[:depth]
        lexical = BM25([docs_tokens[t] for t in top]).scores(qt)
        out[i, top] = alpha * normalize(dense[i, top].astype(np.float64)) + (1 - alpha) * normalize(lexical)
    return out
