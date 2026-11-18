#!/usr/bin/env python3
"""Build embedding fine-tuning data from repositories and their documentation.

    python3 extract_pairs.py --library core/build/libcodeberg.dylib \\
        --repo payments=~/src/payments --repo web=~/src/web \\
        --docs ~/exports/wiki --docs ~/src/payments/api/openapi.yaml \\
        --learning-export ~/exports/query-positive-negative.jsonl --output ~/ft-data

Writes corpus.jsonl (every chunk, as Codeberg indexes them), train.jsonl and
eval.jsonl (held out by repository directory), and stats.json. Nothing leaves
the machine.
"""

import argparse
from collections import Counter
import json
from pathlib import Path

from chunks import DEFINITIONS, chunk_repo, load_library
from docs import doc_files, file_sections
from pairs import SymbolIndex, doc_comment_pairs, section_pairs, split_rows

TEST_MARKERS = ("/test/", "/tests/", "_test.", ".test.", ".spec.", "/__tests__/")


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--library", type=Path, required=True, help="libcodeberg shared library (make build)")
    p.add_argument("--repo", action="append", required=True, metavar="NAME=PATH")
    p.add_argument("--docs", action="append", default=[], type=Path,
                   help="extra docs: wiki export dir, API reference dir or OpenAPI file (repeatable)")
    p.add_argument("--learning-export", action="append", default=[], type=Path,
                   help="codeberg learning export --type query-positive-negative output")
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--eval-percent", type=int, default=15)
    p.add_argument("--include-tests", action="store_true", help="also use test code as positives")
    return p.parse_args()


def repos_from(specs):
    repos = {}
    for spec in specs:
        name, _, path = spec.partition("=")
        if not name or not path:
            raise SystemExit(f"--repo expects NAME=PATH, got {spec!r}")
        repos[name] = Path(path).expanduser().resolve()
    return repos


def doc_rows(repos, extra_docs, index):
    rows = []
    for source, roots in (("repo_docs", list(repos.values())), ("external_docs", extra_docs)):
        for path in doc_files([Path(r).expanduser() for r in roots]):
            rows.extend(section_pairs(file_sections(path), index, source))
    return rows


def learning_rows(paths):
    """Reviewed Codeberg retrieval examples; Codeberg already held out its eval families."""
    rows = []
    for path in paths:
        for line in path.expanduser().read_text().splitlines():
            record = json.loads(line)
            for i, positive in enumerate(record.get("positive", [])):
                rows.append({"query": record["query"], "positive": positive, "positive_id": f"learning:{i}",
                             "negatives": record.get("negative", [])[:3], "source": "learning",
                             "path": "", "group": "learning"})
    return rows


def write_jsonl(path, rows):
    with path.open("w") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")


def main():
    args = parse_args()
    repos = repos_from(args.repo)
    lib = load_library(args.library)

    corpus = [c for repo, root in repos.items() for c in chunk_repo(lib, repo, root)]
    targets = [c for c in corpus if c["kind"] in DEFINITIONS and
               (args.include_tests or not any(m in f"/{c['path']}" for m in TEST_MARKERS))]

    mined = doc_comment_pairs(repos, targets) + doc_rows(repos, args.docs, SymbolIndex(targets))
    train, held = split_rows(mined, args.eval_percent)
    train += learning_rows(args.learning_export)

    args.output.mkdir(parents=True, exist_ok=True)
    write_jsonl(args.output / "corpus.jsonl", corpus)
    write_jsonl(args.output / "train.jsonl", train)
    write_jsonl(args.output / "eval.jsonl", held)

    stats = {"chunks": len(corpus), "definitions": len(targets), "train": len(train), "eval": len(held),
             "train_by_source": Counter(r["source"] for r in train),
             "eval_by_source": Counter(r["source"] for r in held)}
    (args.output / "stats.json").write_text(json.dumps(stats, indent=2) + "\n")
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
