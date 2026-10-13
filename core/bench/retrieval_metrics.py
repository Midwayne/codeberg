"""Exact cosine ranking and metrics for the embedding-only retrieval bench."""

import numpy as np


def rank_queries(documents, queries, cases, vectors):
    scores = queries @ documents.T
    order = np.argsort(-scores, axis=1, kind="stable")
    rows = []
    for case, ranking, values in zip(cases, order, scores):
        relevant = set(case["relevant"])
        ranks = [position + 1 for position, index in enumerate(ranking)
                 if vectors[index]["id"] in relevant]
        if not ranks:
            raise ValueError(f"case {case['id']} has no relevant corpus item")

        result = dict(case, rank=min(ranks), top=[
            {"id": vectors[index]["id"], "path": vectors[index]["path"],
             "symbol": vectors[index]["symbol"], "score": float(values[index])}
            for index in ranking[:10]
        ])
        if case.get("distractor"):
            positions = {vectors[index]["id"]: position for position, index in enumerate(ranking)}
            result["pair_win"] = positions[case["relevant"][0]] < positions[case["distractor"]]
        rows.append(result)
    return rows


def summarize(rows):
    count = len(rows)
    pairs = [row["pair_win"] for row in rows if "pair_win" in row]
    return {"queries": count, "hit_at_1": sum(row["rank"] <= 1 for row in rows) / count,
            "hit_at_5": sum(row["rank"] <= 5 for row in rows) / count,
            "hit_at_10": sum(row["rank"] <= 10 for row in rows) / count,
            "mrr": sum(1 / row["rank"] for row in rows) / count,
            "pair_accuracy": sum(pairs) / len(pairs) if pairs else None}
