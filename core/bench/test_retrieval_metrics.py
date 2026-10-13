import unittest
import numpy as np

from retrieval_metrics import rank_queries, summarize


class RetrievalMetricsTest(unittest.TestCase):
    def test_gold_is_ranked_against_every_distractor_and_ties_are_stable(self):
        corpus = [{"id": name, "path": "test", "symbol": name} for name in ["wrong", "gold", "also"]]
        cases = [{"id": "q", "relevant": ["gold", "also"], "distractor": "wrong"}]
        rows = rank_queries(np.array([[1, 0], [0, 1], [0, 1]]), np.array([[0, 1]]), cases, corpus)

        self.assertEqual(rows[0]["rank"], 1)
        self.assertEqual([item["id"] for item in rows[0]["top"]], ["gold", "also", "wrong"])
        self.assertTrue(rows[0]["pair_win"])
        self.assertEqual(summarize(rows)["mrr"], 1)

    def test_missing_gold_fails_instead_of_disappearing_from_denominator(self):
        with self.assertRaisesRegex(ValueError, "no relevant"):
            rank_queries(np.array([[1.0]]), np.array([[1.0]]),
                         [{"id": "q", "relevant": ["absent"]}],
                         [{"id": "present", "path": "x", "symbol": "x"}])

    def test_hit_rate_and_reciprocal_rank_have_fixed_denominators(self):
        rows = [{"rank": 1, "pair_win": True}, {"rank": 6, "pair_win": False}]
        result = summarize(rows)

        self.assertEqual(result["hit_at_1"], 0.5)
        self.assertEqual(result["hit_at_5"], 0.5)
        self.assertEqual(result["hit_at_10"], 1)
        self.assertAlmostEqual(result["mrr"], 7 / 12)
        self.assertEqual(result["pair_accuracy"], 0.5)
