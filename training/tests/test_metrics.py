import unittest

import numpy as np

from pipeline.metrics import gold_ranks, paired_bootstrap, summarize


class MetricsTest(unittest.TestCase):
    def test_rank_uses_the_best_correct_chunk(self):
        scores = np.array([[0.9, 0.5, 0.8], [0.1, 0.7, 0.3]])

        self.assertEqual(gold_ranks(scores, [[1, 2], [0]]).tolist(), [2, 3])

    def test_summary_and_bootstrap(self):
        base, new = np.array([1, 2, 4, 10]), np.array([1, 1, 2, 10])

        self.assertAlmostEqual(summarize(base)["mrr"], (1 + 0.5 + 0.25 + 0.1) / 4)
        result = paired_bootstrap(base, new)

        self.assertAlmostEqual(result["delta_mrr"], (0 + 0.5 + 0.25 + 0) / 4)
        self.assertEqual((result["better"], result["worse"]), (2, 0))
        self.assertLessEqual(result["low"], result["delta_mrr"])
        self.assertGreaterEqual(result["high"], result["delta_mrr"])


if __name__ == "__main__":
    unittest.main()
