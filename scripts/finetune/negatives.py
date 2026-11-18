"""Choose hard negatives without labelling true answers as wrong.

Positive-aware filtering (NV-Retriever, Moreira et al. 2024): a candidate is
kept only when the base model scores it clearly below the positive, because
near-equal candidates are often unlabelled correct answers.
"""

import numpy as np


def overlaps(a, b):
    """Same file and intersecting line spans (a window chunk containing the positive)."""
    return a["path"] == b["path"] and a["line"] <= b["end_line"] and b["line"] <= a["end_line"]


def choose_negatives(query_vec, positive, corpus, corpus_vecs, count=3, margin=0.95, depth=50):
    """Indices of up to `count` hard negatives for one query."""
    positive_vec = corpus_vecs[positive["index"]]
    ceiling = margin * float(query_vec @ positive_vec)
    scores = corpus_vecs @ query_vec

    chosen = []
    for i in np.argsort(-scores)[:depth]:
        candidate = corpus[i]
        if i == positive["index"] or overlaps(candidate, positive) or scores[i] >= ceiling:
            continue
        if candidate["text"].strip() == positive["text"].strip():
            continue  # duplicated code elsewhere is also a correct answer

        chosen.append(int(i))
        if len(chosen) == count:
            break
    return chosen
