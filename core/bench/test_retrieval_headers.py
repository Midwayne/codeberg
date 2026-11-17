"""Location-header corpus variants and runner metadata used by the header study."""

from importlib.metadata import PackageNotFoundError
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import bench_retrieval
from retrieval_corpus import apply_headers, context_header
from retrieval_doc_eval import build_queries


class ContextHeaderTest(unittest.TestCase):
    def test_styles_place_location_before_the_body(self):
        path = "core/src/embed/embed_worker.c"

        self.assertEqual(context_header(path, 1, "embed", "none"), "")
        self.assertEqual(context_header(path, 1, "embed", "path"), f"path: {path}\n\n")
        self.assertEqual(context_header(path, 2, "embed", "path-symbol"),
                         f"path: {path}\nmethod: embed\n\n")
        self.assertEqual(context_header(path, 1, "embed", "comment"),
                         f"// {path} · function embed\n")
        self.assertEqual(context_header("agent/x.py", 1, "", "comment"), "# agent/x.py\n")

    def test_unknown_style_is_rejected(self):
        with self.assertRaises(ValueError):
            context_header("a.c", 1, "f", "banner")

    def test_synthetic_snippets_share_a_neutral_location(self):
        rows = [
            {"body": "def f(a):\n    return a\n", "path": "fixture/expiry",
             "symbol": "a", "category": "minimal_pairs"},
            {"body": "async function f(url) {}\n", "path": "fixture/pagination",
             "symbol": "b", "category": "minimal_pairs"},
            {"body": "int g(void) {}\n", "path": "core/src/g.c", "symbol": "g",
             "kind": 1, "category": "repository"},
        ]

        apply_headers(rows, "comment")

        self.assertEqual(rows[0]["body"], "# fixture/snippet.py · function f\ndef f(a):\n    return a\n")
        self.assertTrue(rows[1]["body"].startswith("// fixture/snippet.ts · function f\n"))
        self.assertTrue(rows[2]["body"].startswith("// core/src/g.c · function g\n"))
        self.assertNotIn("expiry", rows[0]["body"])


class DocCommentQueryTest(unittest.TestCase):
    def test_comment_above_a_function_becomes_a_masked_query(self):
        source = ("#include <x.h>\n"
                  "/* retry_open reopens the socket after a transient\n"
                  " * failure, up to three times. */\n"
                  "int retry_open(void) {}\n"
                  "\n"
                  "// too short\n"
                  "int quiet(void) {}\n")

        with tempfile.TemporaryDirectory() as root:
            Path(root, "a.c").write_text(source)
            corpus = [
                {"path": "a.c", "line": 4, "symbol": "retry_open", "category": "repository"},
                {"path": "a.c", "line": 7, "symbol": "quiet", "category": "repository"},
                {"path": "fixture/x", "line": 1, "symbol": "a", "category": "minimal_pairs"},
            ]

            queries = build_queries(Path(root), corpus)

        self.assertEqual(len(queries), 1)
        self.assertEqual(queries[0]["index"], 0)
        self.assertEqual(queries[0]["query"],
                         "this function reopens the socket after a transient failure, up to three times.")


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
