"""Hard-negative selection on hand-built vectors (no model needed)."""

import unittest

import numpy as np

from pipeline.negatives import choose_negatives


def row(i, path, line, end_line, text):
    return {"index": i, "path": path, "line": line, "end_line": end_line, "text": text}


class ChooseNegativesTest(unittest.TestCase):
    def setUp(self):
        self.corpus = [
            row(0, "a.go", 1, 10, "func Positive() {}"),
            row(1, "a.go", 1, 50, "window containing the positive"),
            row(2, "b.go", 1, 5, "func NearCopy() {}"),       # scores like the positive: likely correct
            row(3, "c.go", 1, 5, "func Positive() {}"),        # identical code elsewhere
            row(4, "d.go", 1, 5, "func HardNegative() {}"),
            row(5, "e.go", 1, 5, "func Unrelated() {}"),
        ]
        angles = [0.0, 0.05, 0.1, 0.0, 0.6, 1.4]
        self.vecs = np.array([[np.cos(a), np.sin(a)] for a in angles], dtype=np.float32)
        self.query = np.array([1.0, 0.0], dtype=np.float32)

    def test_skips_positive_overlaps_near_ties_and_duplicates(self):
        got = choose_negatives(self.query, self.corpus[0], self.corpus, self.vecs, count=2, margin=0.95)

        self.assertEqual(got, [4, 5])

    def test_count_limits_the_result(self):
        got = choose_negatives(self.query, self.corpus[0], self.corpus, self.vecs, count=1)

        self.assertEqual(got, [4])


if __name__ == "__main__":
    unittest.main()
