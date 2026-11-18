"""Ranking metrics and the paired bootstrap used to accept or reject a model."""

import numpy as np


def gold_ranks(scores, gold):
    """1-based rank of each query's best-scoring correct chunk (ties count against it)."""
    return np.array([int((row > max(row[g] for g in golds)).sum()) + 1 for row, golds in zip(scores, gold)])


def summarize(ranks):
    ranks = np.asarray(ranks)
    return {"queries": int(len(ranks)), "mrr": float(np.mean(1 / ranks)),
            "hit_at_1": float(np.mean(ranks <= 1)), "hit_at_5": float(np.mean(ranks <= 5)),
            "hit_at_10": float(np.mean(ranks <= 10))}


def paired_bootstrap(base_ranks, new_ranks, resamples=10000, seed=0):
    """Mean ΔMRR and its 95% interval over queries resampled with replacement."""
    diff = 1 / np.asarray(new_ranks, dtype=float) - 1 / np.asarray(base_ranks, dtype=float)
    picks = np.random.default_rng(seed).integers(0, len(diff), (resamples, len(diff)))
    means = diff[picks].mean(axis=1)
    return {"delta_mrr": float(diff.mean()), "low": float(np.percentile(means, 2.5)),
            "high": float(np.percentile(means, 97.5)),
            "better": int((diff > 0).sum()), "worse": int((diff < 0).sum())}
