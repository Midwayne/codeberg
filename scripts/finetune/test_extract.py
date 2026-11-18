"""Pair extraction from code and documentation (no model or GPU needed)."""

from pathlib import Path
import tempfile
import unittest

from comments import leading_comment, python_docstrings
from docs import html_sections, markdown_sections, openapi_operations
from pairs import (SymbolIndex, doc_comment_pairs, group_of, mask_names, section_pairs,
                   split_rows)


def chunk(path, symbol, line, end_line, text, repo="svc", kind="function"):
    return {"id": f"{repo}:{path}:{line}", "repo": repo, "path": path, "symbol": symbol,
            "kind": kind, "line": line, "end_line": end_line, "text": text}


class LeadingCommentTest(unittest.TestCase):
    def test_block_and_line_comments_above_a_function(self):
        lines = ["#include <x.h>", "", "/* Reopen the socket after a transient",
                 " * failure, at most three times. */", "int reopen(void) {"]
        self.assertEqual(leading_comment(lines, 5),
                         "Reopen the socket after a transient failure, at most three times.")

        go = ["// Stop waits for engine shutdown before callers", "// delete caches.", "func (s *S) Stop() {"]
        self.assertEqual(leading_comment(go, 3), "Stop waits for engine shutdown before callers delete caches.")

    def test_annotations_between_comment_and_definition_are_skipped(self):
        java = ["/** Returns the cached value, loading it once. */", "@Override", "public V get(K key) {"]
        self.assertEqual(leading_comment(java, 3), "Returns the cached value, loading it once.")

    def test_license_headers_and_markers_are_not_queries(self):
        header = ["// Copyright 2024 Example Corp. Licensed under the Apache License.", "func Init() {"]
        self.assertEqual(leading_comment(header, 2), "")
        self.assertEqual(leading_comment(["#include <stdio.h>", "int main(void) {"], 2), "")

    def test_python_docstrings_are_queries_and_removed_from_the_body(self):
        source = 'def load(key):\n    """Load a value once and cache misses too."""\n    return cache[key]\n'

        found = python_docstrings(source)

        self.assertEqual(found[1], ("Load a value once and cache misses too.", {1}))


class DocsTest(unittest.TestCase):
    def test_markdown_sections_keep_breadcrumbs_and_drop_code_blocks(self):
        text = ("# Retries\nIntro.\n\n## Backoff\nUse `retry_with_backoff` for flaky calls.\n"
                "```go\nfunc retry_with_backoff() {}\n```\nIt doubles the delay.\n")

        sections = markdown_sections(text)

        self.assertEqual(sections[1]["title"], "Retries > Backoff")
        self.assertIn("`retry_with_backoff`", sections[1]["text"])
        self.assertNotIn("func retry_with_backoff", sections[1]["text"])
        self.assertIn("doubles the delay", sections[1]["text"])

    def test_html_wiki_export_becomes_sections(self):
        html = ("<html><head><style>p{}</style></head><body><h1>Cache</h1><p>Call <code>LoadOnce</code> "
                "to memoize.</p><pre>LoadOnce(k)</pre><h2>Eviction</h2><p>Entries expire.</p></body></html>")

        sections = html_sections(html)

        self.assertEqual([s["title"] for s in sections], ["Cache", "Cache > Eviction"])
        self.assertIn("`LoadOnce`", sections[0]["text"])
        self.assertNotIn("LoadOnce(k)", sections[0]["text"])

    def test_openapi_operations_map_operation_ids_to_descriptions(self):
        spec = {"openapi": "3.0.0", "paths": {"/users/{id}": {"get": {"operationId": "getUserById",
                                                    "summary": "Fetch one user",
                                                    "description": "Returns 404 when the user was deleted."}}}}

        ops = openapi_operations(spec)

        self.assertEqual(ops[0]["title"], "GET /users/{id}")
        self.assertIn("`getUserById`", ops[0]["text"])
        self.assertIn("404", ops[0]["text"])

    def test_json_that_is_not_an_openapi_document_is_ignored(self):
        self.assertEqual(openapi_operations({"paths": 3}), [])
        self.assertEqual(openapi_operations({"openapi": "3.1.0", "paths": {"/x": "not-an-object"}}), [])


class PairsTest(unittest.TestCase):
    def test_masking_hides_the_target_name_in_every_spelling(self):
        self.assertEqual(mask_names("Call `retryWithBackoff` or RetryWithBackoff()", ["retryWithBackoff"]),
                         "Call `this function` or this function()")

    def test_doc_comment_pairs_mask_the_name_and_strip_python_docstrings(self):
        with tempfile.TemporaryDirectory() as root:
            Path(root, "a.py").write_text('def load_once(key):\n    """Load a value once and cache '
                                          'misses too, so load_once never repeats work."""\n    return key\n')
            Path(root, "b.go").write_text("// tiny\nfunc Tiny() {}\n")
            chunks = [chunk("a.py", "load_once", 1, 3, Path(root, "a.py").read_text()),
                      chunk("b.go", "Tiny", 2, 2, "func Tiny() {}")]

            rows = doc_comment_pairs({"svc": Path(root)}, chunks)

        self.assertEqual(len(rows), 1)
        self.assertIn("this function never repeats", rows[0]["query"])
        self.assertNotIn("cache misses", rows[0]["positive"])
        self.assertIn("return key", rows[0]["positive"])

    def test_sections_link_to_specific_mentioned_symbols_only(self):
        chunks = [chunk("cache/load.go", "LoadOnce", 1, 5, "func LoadOnce() {}"),
                  chunk("a/x.go", "New", 1, 2, "func New() {}"), chunk("b/y.go", "New", 1, 2, "func New() {}"),
                  chunk("c/z.go", "New", 1, 2, "func New() {}"), chunk("d/w.go", "New", 1, 2, "func New() {}")]
        index = SymbolIndex(chunks)
        section = {"title": "Cache > Loading", "text": "Use `LoadOnce` to memoize expensive reads; call `New` first "
                                                       "to build the cache with sane defaults."}

        rows = section_pairs([section], index, source="docs")

        self.assertEqual([r["positive_id"] for r in rows], ["svc:cache/load.go:1"])
        self.assertNotIn("LoadOnce", rows[0]["query"])

    def test_generic_single_words_are_not_linked(self):
        chunks = [chunk("q.ts", "root", 1, 3, "get root() {}"), chunk("w.c", "cberg_watcher_open", 1, 9, "int x;")]
        section = {"title": "Watcher", "text": "Opens a recursive watch on `root`; `root` must exist before "
                                               "you call `cberg_watcher_open` with a valid path."}

        rows = section_pairs([section], SymbolIndex(chunks), source="docs")

        self.assertEqual([r["positive_id"] for r in rows], ["svc:w.c:1"])
        self.assertIn("`root`", rows[0]["query"])

    def test_heading_target_wins_over_body_mentions(self):
        chunks = [chunk("t.c", "cberg_table_sync", 1, 9, "int sync;"), chunk("t.h", "cberg_table_entry", 1, 3, "struct e;")]
        section = {"title": "API > `cberg_table_sync`", "text": "Builds a staging copy of each "
                                                                  "`cberg_table_entry`, then swaps it in atomically."}

        rows = section_pairs([section], SymbolIndex(chunks), source="docs")

        self.assertEqual([r["positive_id"] for r in rows], ["svc:t.c:1"])

    def test_signature_heading_links_its_subject_not_parameter_types(self):
        chunks = [chunk("a.c", "cberg_arena_strdup", 1, 9, "char *x;"),
                  chunk("a.h", "cberg_arena", 1, 3, "struct a;", kind="struct")]
        section = {"title": "API > `cberg_arena_strdup(cberg_arena *arena, const char *src)`",
                   "text": "Copies the string into arena memory and NUL-terminates it; returns NULL when full."}

        rows = section_pairs([section], SymbolIndex(chunks), source="docs")

        self.assertEqual([r["positive_id"] for r in rows], ["svc:a.c:1"])
        self.assertIn("this function(cberg_arena", rows[0]["query"])

    def test_duplicate_names_need_a_mentioned_file(self):
        chunks = [chunk("w/watch_fsevents.c", "watch_platform_wait", 1, 9, "a"),
                  chunk("w/watch_inotify.c", "watch_platform_wait", 1, 9, "b")]
        index = SymbolIndex(chunks)
        mac = {"title": "Backends > macOS (`watch_fsevents.c`)",
               "text": "`watch_platform_wait` blocks on the FSEvents stream and drains coalesced events."}
        vague = {"title": "Backends", "text": "Each backend implements `watch_platform_wait` to block until "
                                              "events arrive or the timeout passes."}

        self.assertEqual([r["positive_id"] for r in section_pairs([mac], index, "docs")], ["svc:w/watch_fsevents.c:1"])
        self.assertEqual(section_pairs([vague], index, "docs"), [])

    def test_overview_tables_are_skipped(self):
        names = [f"cberg_mod{i}_open" for i in range(10)]
        chunks = [chunk(f"m{i}.c", n, 1, 2, "int x;") for i, n in enumerate(names)]
        table = " ".join(f"| `{n}` | opens module {i} |" for i, n in enumerate(names))

        self.assertEqual(section_pairs([{"title": "Modules", "text": table}], SymbolIndex(chunks), "docs"), [])

    def test_types_are_masked_as_types(self):
        chunks = [chunk("e.ts", "HttpError", 1, 3, "class HttpError {}", kind="class")]
        section = {"title": "Errors", "text": "Every failed request raises `HttpError` carrying the server "
                                              "message and the HTTP status code."}

        rows = section_pairs([section], SymbolIndex(chunks), source="docs")

        self.assertIn("`this type`", rows[0]["query"])

    def test_split_keeps_directories_together_and_is_stable(self):
        rows = [{"group": group_of("svc", f"pkg{i % 7}/sub/f{i}.go"), "query": str(i)} for i in range(200)]

        train, held = split_rows(rows, percent=20)
        again, _ = split_rows(rows, percent=20)

        self.assertEqual(train, again)
        self.assertFalse({r["group"] for r in train} & {r["group"] for r in held})
        self.assertTrue(held)


if __name__ == "__main__":
    unittest.main()
