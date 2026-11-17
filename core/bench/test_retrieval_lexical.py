"""The BM25 rescoring reference must match the daemon's Go implementation."""

import unittest

import numpy as np

from retrieval_lexical import rescore_pool, tokens


class TokensTest(unittest.TestCase):
    def test_identifier_splitting_matches_the_go_cases(self):
        # Same table as daemon/internal/search/tokens_test.go.
        cases = {
            "parseJSONConfig": ["parsejsonconfig", "parse", "json", "config"],
            "cberg_worker_embed": ["cberg", "worker", "embed"],
            "HTTPServer x2": ["httpserver", "http", "server", "x2", "x", "2"],
            "retry(3, 'Ok')": ["retry", "3", "ok"],
            "ÜberCache": ["bercache", "ber", "cache"],
        }

        for text, want in cases.items():
            with self.subTest(text=text):
                self.assertEqual(tokens(text), want)

    def test_query_tokens_drop_stop_words(self):
        got = tokens("Where is the vector retry with a 3 second backoff?", stop=True)

        self.assertEqual(got, ["vector", "retry", "second", "backoff"])


class RescoreTest(unittest.TestCase):
    def test_keyword_match_lifts_a_near_tie(self):
        bodies = ["func add(a, b int) int { return a + b }",
                  "func retryWithBackoff(op func() error) error { return op() }",
                  "func unrelated() {}"]
        dense = np.array([[0.80, 0.79, 0.10]])

        fused = rescore_pool(dense, [tokens(b) for b in bodies], [tokens("retry with backoff", stop=True)])

        self.assertEqual(list(np.argsort(-fused[0])), [1, 0, 2])


if __name__ == "__main__":
    unittest.main()
