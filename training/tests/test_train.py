"""Training rows become triplets (with a hard negative) or plain pairs."""

import importlib.util
import unittest

HAS_DATASETS = importlib.util.find_spec("datasets") is not None


@unittest.skipUnless(HAS_DATASETS, "needs the training environment (datasets)")
class DatasetsTest(unittest.TestCase):
    def test_rows_split_into_triplets_and_pairs(self):
        from pipeline.train import datasets

        rows = [{"query": "q1", "positive": "p1", "negatives": ["n1", "n2"]},
                {"query": "q2", "positive": "p2", "negatives": []},
                {"query": "q3", "positive": "p3"}]

        out = datasets(rows, max_negatives=1)

        self.assertEqual(out["triplets"].to_list(), [{"anchor": "q1", "positive": "p1", "negative": "n1"}])
        self.assertEqual([r["anchor"] for r in out["pairs"].to_list()], ["q2", "q3"])


if __name__ == "__main__":
    unittest.main()
