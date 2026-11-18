"""Ensure benchmark metadata matches the production input limits."""

from importlib.metadata import PackageNotFoundError
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest import mock

import bench_retrieval
from bench_retrieval import token_stats


class RetrievalSettingsTest(unittest.TestCase):
    def test_truncation_counts_use_each_adapters_input_limit(self):
        lengths = [8192, 8193]
        corpus = [{"body": str(length), "category": "long_context"} for length in lengths]
        tokenizer = mock.Mock(side_effect=lambda text: {
            "input_ids": [0] * int(text.split()[-1]),
        })
        transformers = SimpleNamespace(AutoTokenizer=SimpleNamespace(
            from_pretrained=lambda *args, **kwargs: tokenizer))

        with mock.patch.dict(sys.modules, {"transformers": transformers}):
            for backend, limit, truncated in [
                ("gemma-mlx", 8192, 1), ("sentence-transformers", 8192, 1),
                ("mlx", 512, 2), ("jina-onnx", 512, 2),
            ]:
                with self.subTest(backend=backend):
                    result = token_stats(Path("/local/model"), backend, corpus)

                    self.assertEqual(result["limit"], limit)
                    self.assertEqual(result["truncated_documents"], truncated)
                    self.assertEqual(result["long_fixture_tokens"], lengths)


class VersionMetadataTest(unittest.TestCase):
    def test_missing_optional_packages_are_recorded_as_absent(self):
        def fake_version(name):
            if name == "onnxruntime":
                return "1.20.1"
            raise PackageNotFoundError(name)

        with mock.patch.object(bench_retrieval, "version", side_effect=fake_version):
            versions = bench_retrieval.package_versions()

        self.assertEqual(versions["onnxruntime"], "1.20.1")
        self.assertIsNone(versions["mlx"])


if __name__ == "__main__":
    unittest.main()
