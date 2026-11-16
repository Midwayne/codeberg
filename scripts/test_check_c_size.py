"""Tests for scripts/check-c-size.py."""

import importlib.util
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("check-c-size.py")
spec = importlib.util.spec_from_file_location("check_c_size", SCRIPT)
check_c_size = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_c_size)


def measure(source):
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "sample.c"
        path.write_text(textwrap.dedent(source))
        return {name: (start, count) for name, start, count in check_c_size.functions(path)}


class FunctionsTest(unittest.TestCase):
    def test_counts_from_signature_to_closing_brace(self):
        found = measure(
            """\
            #include <stdio.h>

            static int add(int a,
                           int b) {
                return a + b;
            }
            """
        )

        self.assertEqual(found, {"add": (3, 4)})

    def test_ignores_types_and_initializers(self):
        found = measure(
            """\
            typedef struct { int x; } point;
            struct node { int y; };
            enum color { RED };
            static const int table[] = { 1, 2 };
            void run(void) {
            }
            """
        )

        self.assertEqual(list(found), ["run"])

    def test_braces_in_comments_strings_and_directives_do_not_count(self):
        found = measure(
            """\
            void show(void) {
                /* } */
                puts("}{");
                char c = '}';
            #define OPEN {
            }
            void after(void) {
            }
            """
        )

        self.assertEqual(found, {"show": (1, 6), "after": (7, 2)})

    def test_skips_tests_benchmarks_and_vendored_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for rel in ["src/a.c", "src/test/b.c", "bench/c.c", "third_party/d.c"]:
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text("void f(void) {}\n")

            found = [path.relative_to(root).as_posix() for path in check_c_size.source_files([root])]

        self.assertEqual(found, ["src/a.c"])


if __name__ == "__main__":
    unittest.main()
