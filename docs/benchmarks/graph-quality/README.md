# Graph resolution quality — 2026-11-03

This is the historical first Go/TS/JS pass. See the expanded
[all-language and multi-repository report](all-languages.md) for current results.
The original 55-site manifest is retained in [initial-cases.txt](initial-cases.txt).
To rerun this subset, export
`CBERG_GRAPH_QUALITY_CASES=docs/benchmarks/graph-quality/initial-cases.txt` before
the evaluator commands below. The default evaluator now covers a broader corpus;
the original checksum and runtime measurements describe the earlier snapshot.

The deterministic Go/TypeScript/JavaScript pass improves target resolution on
this **targeted regression corpus**. It is not a held-out or representative
codebase benchmark, and its 100% precision does not imply compiler-level accuracy.
The corpus was developed alongside the implementation using failing tests.

Baseline: `ae22a78940c9983bd50be7c0c953ecf5042c39ca`, built from the clean parent
before production edits. The same final evaluator and fixtures were linked
against that frozen static library and the updated library. No embedding model,
LLM, network service, or LSP participates in this measurement.

## Results

21 scenarios contain 55 annotated sites: 48 expected edges and seven negative
sites where no resolved target should be emitted.

| Metric | Parent | Updated |
| --- | ---: | ---: |
| Correct edges (TP) | 29 | 45 |
| Incorrect edges (FP) | 30 | 0 |
| Missed expected edges (FN) | 19 | 3 |
| Precision: TP / (TP + FP) | 49.2% | 100.0% |
| Recall: TP / (TP + FN) | 60.4% | 93.8% |
| F1 | 54.2% | 96.8% |

The three misses are deliberately retained in the score: one function-value
alias, one default import, and one re-export chain. They have explicit expected
targets and allowed-miss budgets; other scenarios allow no misses. Every
scenario rejects incorrect edges, including at negative sites. The evaluator
also saves/reloads every graph and requires the scores to remain identical.

Coverage includes same-name decoys, lexical shadowing, JS parameters and temporal
dead zones, named/namespace import aliases, Go packages and receivers, shared Go
parameter types, source-relative parent paths, directory entrypoints, `.js`
specifiers targeting TypeScript, callbacks, non-call references, same-file
inheritance, overrides, arrow `this`, and detached ordinary functions.

An additional lifecycle test moves `util.ts` to `util/index.ts` and verifies that
an unchanged importer follows the replacement. It then reindexes an alias and
checks cached resolution again. The old graph snapshot version requests a cold
rebuild. Daemon tests verify combined graph/lexical coverage, deduplication, shared
limits, and usable results when either source fails. Agent tests verify both
evidence arrays survive extraction.

## Oracle and limits

Fixtures and their manually specified oracle are in
[`core/test/fixtures/graph_quality`](../../../core/test/fixtures/graph_quality).
`expected.tsv` identifies edge kind, source file, source line, target file, and
target definition start line. `-` means no resolved edge. See the
[fixture guide](../../../core/test/fixtures/graph_quality/README.md).

The evaluator scores unique edge tuples at annotated sites only. It counts
wrong additional destinations as FP, even if the correct edge is also present.
Unannotated sites, source chunk identity, complete repository recall, and runtime
dispatch correctness are not scored. This is structural target-resolution
quality; lexical `grep` evidence, which can include comments/declarations, is not
mixed into these precision/recall figures. All five Go fixture modules also
compile with `go test ./...`.

Known gaps include function-value aliases, default exports/imports, re-exports,
destructuring, flow-sensitive reassignment, interfaces/generics, external Go test
packages sharing a directory, implicit Go package names differing from their
path, cross-file inheritance, and dynamic receivers. Inheritance method lookup
is limited to eight same-file class levels. Unknown expressions can remain
unresolved. Other languages keep their previous name-based call resolution.

A broader independently labelled repository corpus is needed before treating
these numbers as general accuracy. No performance improvement is claimed.

## Runtime cost

Apple M4, macOS arm64, Release build, same CMake configuration/dependencies,
five runs of the existing `bench_graph` on each implementation. Medians are
wall-clock milliseconds for each entire benchmark section, not individual calls.
This measures a small synthetic graph, not end-to-end project indexing.

| Section | Parent ms | Updated ms | Change |
| --- | ---: | ---: | ---: |
| Cold apply, 200 files | 36.458 | 45.999 | +26.2% |
| Apply/remove churn, 50 operations | 2.793 | 5.030 | +80.1% |
| Incoming hub edges, 200 queries | 0.245 | 0.431 | +75.9% |
| BFS, 100 queries | 0.610 | 1.094 | +79.3% |
| Hubs, 50 queries | 2.799 | 2.714 | -3.0% |
| Save | 0.933 | 1.121 | +20.2% |
| Load | 1.053 | 1.335 | +26.8% |

Scope/receiver checks and persisted context add measurable overhead. The small
hub timing difference should not be interpreted as an optimization. Benchmark
input is unchanged; the graph has 3,401 stored references in both runs. Raw trials
are retained so the medians and noise can be inspected.

## Reproduce

From the repository root, with normal C build prerequisites installed:

```sh
cmake -S core -B core/build -DCMAKE_BUILD_TYPE=Release
cmake --build core/build --target test_graph_quality test_graph_scope_lifecycle bench_graph -j4
core/build/test/test_graph_quality
ctest --test-dir core/build -R '^test_graph' --output-on-failure
for trial in 1 2 3 4 5; do core/build/bench/bench_graph; done
```

`test_graph_quality --report-only` emits the same JSONL but permits quality
failures; harness/load failures still fail. Normal test mode enforces the
per-scenario miss budgets in `cases.txt`.

To reproduce the comparison, build `libcodeberg.a` at the baseline commit before
applying this change and preserve it as `/tmp/codeberg-graph-parent.a`. Preserve
five baseline `bench_graph` runs too. Build the updated tree above, then compile
the final evaluator against the baseline archive using the generated CMake link
command. The comparison used this recipe (same architecture/toolchain required):

```sh
python3 - <<'PY'
from pathlib import Path
import shlex, subprocess

root = Path.cwd()
obj = '/tmp/codeberg-graph-quality-parent.o'
includes = ['-I' + str(root / p) for p in (
    'core/include', 'core/src/common', 'core/test')]
fixture = root / 'core/test/fixtures/graph_quality'
subprocess.run(['cc', '-std=gnu11', *includes,
    f'-DCBERG_GRAPH_QUALITY_DIR="{fixture}"', '-c',
    str(root / 'core/test/test_graph_quality.c'), '-o', obj], check=True)

linkfile = root / 'core/build/test/CMakeFiles/test_graph_quality.dir/link.txt'
link = shlex.split(linkfile.read_text())
link = [obj if a.endswith('test_graph_quality.c.o') else
    '/tmp/codeberg-graph-parent.a' if a == '../libcodeberg.a' else a
    for a in link]
link[link.index('-o') + 1] = '/tmp/codeberg-graph-quality-parent'
subprocess.run(link, cwd=root / 'core/build/test', check=True)
subprocess.run(['/tmp/codeberg-graph-quality-parent', '--report-only'], check=True)
PY
```

This link recipe assumes CMake's Makefile generator. An isolated baseline
checkout can instead build the same evaluator with its own generated link
command and matching dependencies. Keep the final corpus identical on both runs.

## Recorded artifacts and verification

- [Baseline scores](baseline.jsonl), [updated scores](current.jsonl).
- [Baseline benchmark trials](baseline-bench.json), [updated trials](current-bench.json).
- [Machine-readable summary and corpus checksum](summary.json).
- Core: `make check`; embedding/search model tests skip without model weights.
- Daemon: `make daemon-check`.
- Agent/UI: `make agent-check` (includes documentation link/anchor tests).
