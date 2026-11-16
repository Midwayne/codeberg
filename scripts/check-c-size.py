#!/usr/bin/env python3
"""Fail when a C core production function is longer than the limit.

Counts every line from the start of the function's signature to its closing
brace, including comments and blank lines, like the Go and TypeScript size
linters. Tests, benchmarks, and vendored code are not checked.

Usage: scripts/check-c-size.py [--max-function-lines N] [paths...]
"""

import argparse
import re
import sys
from pathlib import Path

DEFAULT_ROOTS = ["core/src", "core/cmd"]
SKIPPED_DIRS = {"test", "tests", "bench", "third_party"}
NOT_FUNCTIONS = re.compile(r"^\s*(typedef|struct|union|enum)\b")
FUNCTION_NAME = re.compile(r"([A-Za-z_]\w*)\s*\($")


def strip_code(text):
    """Blank out comments, strings, char literals, and preprocessor lines,
    keeping newlines so line numbers stay aligned."""
    out = []
    i, n = 0, len(text)
    at_line_start = True

    while i < n:
        c = text[i]

        if at_line_start and c in " \t":
            out.append(c)
            i += 1
            continue

        if at_line_start and c == "#":
            # Preprocessor directive, including backslash continuations.
            while i < n and not (text[i] == "\n" and text[i - 1] != "\\"):
                out.append("\n" if text[i] == "\n" else " ")
                i += 1
            continue

        at_line_start = c == "\n"

        if text.startswith("//", i):
            while i < n and text[i] != "\n":
                out.append(" ")
                i += 1
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = n if end == -1 else end + 2
            out.extend("\n" if ch == "\n" else " " for ch in text[i:end])
            i = end
        elif c in "\"'":
            j = i + 1
            while j < n and text[j] != c:
                j += 2 if text[j] == "\\" else 1
            out.extend("\n" if ch == "\n" else " " for ch in text[i : j + 1])
            i = j + 1
        else:
            out.append(c)
            i += 1

    return "".join(out)


def functions(path):
    """Yields (name, first_line, line_count) for each function definition."""
    code = strip_code(path.read_text(encoding="utf-8", errors="replace"))
    depth = 0
    header_start = None
    header = []
    open_line = 0
    current = None

    for lineno, line in enumerate(code.split("\n"), start=1):
        for c in line:
            if depth == 0:
                if c in ";}":
                    header, header_start = [], None
                    continue
                if c == "{":
                    text = "".join(header)
                    is_function = "(" in text and "=" not in text and not NOT_FUNCTIONS.match(text)
                    if is_function:
                        name = FUNCTION_NAME.search(text[: text.index("(") + 1])
                        current = (name.group(1) if name else "?", header_start or lineno)
                    depth = 1
                    header, header_start = [], None
                    continue
                if not c.isspace() and header_start is None:
                    header_start = lineno
                header.append(c)
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0 and current is not None:
                    name, start = current
                    yield name, start, lineno - start + 1
                    current = None
        if depth == 0:
            header.append("\n")
        open_line = lineno

    if depth != 0:
        raise ValueError(f"{path}: unbalanced braces (ended at depth {depth}, line {open_line})")


def source_files(roots):
    for root in roots:
        root = Path(root)
        if root.is_file():
            yield root
            continue

        for path in sorted(root.rglob("*.c")):
            if not SKIPPED_DIRS.intersection(path.relative_to(root).parts):
                yield path


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--max-function-lines", type=int, default=50)
    parser.add_argument("paths", nargs="*", default=DEFAULT_ROOTS)
    args = parser.parse_args()

    violations = []
    for path in source_files(args.paths):
        for name, start, count in functions(path):
            if count > args.max_function_lines:
                violations.append(f"{path}:{start}: {name} has {count} lines; limit is {args.max_function_lines}")

    for violation in violations:
        print(violation, file=sys.stderr)

    if violations:
        print(f"C size lint failed with {len(violations)} violation(s)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
