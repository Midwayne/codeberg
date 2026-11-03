# All-language and cross-repository graph evaluation

Measured on 2026-11-03, Apple M4, macOS arm64, Release build.
The [review-fix evaluation](review-fixes.md) records the expanded corpus and corrected results from 2026-11-04. No embedding model,
LLM, LSP, external service, or network lookup participates in these tests.

This historical snapshot covers **all nine supported source languages**, with harder
scope/receiver cases. The initial Go/TS/JS pass's 100% precision was a narrower
regression result; it is not an all-language accuracy claim. These fixtures were
developed alongside the resolver, are small and uneven across languages, and
are not an independent or representative benchmark.

## Structural target resolution

33 scenarios contain 73 annotated sites: 64 expected edges and nine negatives.
The same final evaluator and fixtures were linked against three libraries:

- Parent `ae22a78940c9983bd50be7c0c953ecf5042c39ca`, built before implementation.
- The first Go/TS/JS pass's frozen library, captured before multi-repo work.
- The current library, which also fixes C function-pointer parameter shadowing
  and Python parameter/nested-function scope.

| Metric | Parent | First pass on expanded corpus | Current |
| --- | ---: | ---: | ---: |
| Correct edges | 41 | 61 | 61 |
| Incorrect edges | 38 | 12 | 8 |
| Missed edges | 23 | 3 | 3 |
| Precision | 51.9% | 83.6% | 88.4% |
| Recall | 64.1% | 95.3% | 95.3% |
| F1 | 57.3% | 89.1% | 91.7% |

Current per-language results:

| Language | Annotated sites | Correct / incorrect / missed | Precision | Recall |
| --- | ---: | --- | ---: | ---: |
| Go | 12 | 12 / 0 / 0 | 100% | 100% |
| TypeScript | 40 | 32 / 0 / 3 | 100% | 91.4% |
| JavaScript | 3 | 1 / 0 / 0 | 100% | 100% |
| C | 3 | 2 / 0 / 0 | 100% | 100% |
| Python | 3 | 2 / 0 / 0 | 100% | 100% |
| Java | 3 | 3 / 2 / 0 | 60% | 100% |
| Kotlin | 3 | 3 / 2 / 0 | 60% | 100% |
| Rust | 3 | 3 / 2 / 0 | 60% | 100% |
| Ruby | 3 | 3 / 2 / 0 | 60% | 100% |

The eight incorrect edges come from Java/Kotlin/Rust/Ruby receiver matching:
`user.save()` and `cache.save()` each retain both same-name method candidates.
These languages need stronger receiver/type resolution. The three TypeScript
misses remain function-value aliases, a default import, and a re-export chain.
Non-call graph reference extraction still covers Go/TS/JS; lexical reference
search supplies additional evidence in all languages.

Known receiver errors are explicit budgets of two FP per affected scenario in
`cases.txt`. They remain in every reported precision figure. The test gate
prevents additional errors; a passing suite does not mean perfect graph quality.
All other scenarios allow no incorrect edges. Every scenario also requires
identical scores after graph save/reload.

Markdown, YAML, TOML, and JSON are additionally checked for nonempty chunks and
absence of code graph fragments. They intentionally have no call-graph score.
C++ and other unlisted source languages are not claimed as supported.

## Cross-repository behavior

The engine test builds three roots: an importer, a provider, and an unrelated
same-name provider. It tests **one import-backed call and one unrelated-provider
negative in every source language**: 18 sites, 9 correct edges, 0 incorrect
edges, and 0 misses, across all five runs. This is basic import-link coverage,
not a general cross-repo precision or dispatch guarantee. These results are
reported separately from the 73-site structural corpus above.

The oracle verifies caller name, callee name, provider path, and both repository
keys. Other checks cover two-hop traversal into the provider, aggregated search
and architecture, identical relative paths, ambiguous unscoped trace names,
duplicate Go/JS provider identities, 70 same-name definitions, manifest-only cache invalidation, and target
deletion without editing the importer. Daemon/agent tests cover repo-aware
deduplication, cross-repo blast radius, graph/lexical fan-out, IPC truncation, and
retaining source repos in evidence.

The implementation builds a cached combined query view of roots configured
together. It namespaces internal IDs/paths and restores native IDs/relative
paths in responses with `src_repo` and `dst_repo`. Starting definitions can be
scoped by `repo`; import-backed references and traces can cross into another
root. Unrelated same-name symbols do not create a cross-root dependency.
An ambiguous trace spanning several roots requires `repo`.

Example:

```sh
codeberg --root "$HOME/projects/api,$HOME/projects/storage" --no-vector
```

Separately selected browser projects remain isolated. No automatic graph is
built across every project ever registered. No RPC/service relationships,
external package contents, build flags, runtime loading, or compiler visibility
rules are inferred. Go manifests, simple JS package exports/entrypoints,
Python module paths, Java/Kotlin package declarations, simple Cargo package/use
paths with default module layouts, and explicit relative include/require paths
provide the supported linking evidence. Aliases and complex package/build
configurations can remain unresolved. Legacy receiver ambiguity still applies.

The view uses extra RAM and rebuilds after source graph changes or supported
manifest metadata changes. Per-repo sidecars remain independent. This snapshot used graph format
v3, which invalidated older binding semantics and rebuilds once; the public C ABI and
chunk/vector formats stay unchanged.

## Runtime observations

Five trials on the small three-root fixture measured a median **0.340 ms** for
first-query view construction/search and **1.012 ms for 200 cached searches**.
This excludes initial source indexing and is not a large-repository latency
estimate. The test verifies that unchanged queries reuse the cached view.

Five runs of the existing core microbench produced these current medians:

| Section | Median ms for whole section |
| --- | ---: |
| Cold apply, 200 files | 48.960 |
| Apply/remove churn, 50 operations | 5.572 |
| Incoming hub edges, 200 queries | 0.447 |
| BFS, 100 queries | 1.150 |
| Hubs, 50 queries | 2.824 |
| Save | 1.270 |
| Load | 1.142 |

The original parent cold-apply median was 36.458 ms. These feature changes add
overhead; no performance improvement is claimed. Raw trials are retained.

## Reproduce and inspect

```sh
cmake -S core -B core/build -DCMAKE_BUILD_TYPE=Release
cmake --build core/build --target test_graph_quality test_workspace_graph test_graph_extract bench_graph -j4
CBERG_GRAPH_QUALITY_CASES="$PWD/docs/benchmarks/graph-quality/all-languages/cases.txt" core/build/test/test_graph_quality
core/build/cmd/cberg-index/test_workspace_graph
ctest --test-dir core/build -R '^(test_graph|test_graph_extract|test_workspace_graph)$' --output-on-failure
```

`test_graph_quality --report-only` permits quality failures while retaining all
scores. The [original report](README.md#reproduce) documents relinking the same
evaluator against a frozen baseline archive. The first-pass library is an
uncommitted session snapshot; its archive checksum is recorded in the summary,
not represented as a separate commit. The workspace fixture and its full oracle
are in `core/cmd/cberg-index/test_workspace_graph.c`.

- [Parent scores](all-languages/parent.jsonl), [first-pass scores](all-languages/first-pass.jsonl), [current scores](all-languages/current.jsonl).
- [Five workspace trials](all-languages/workspace-trials.json), [five core trials](all-languages/core-bench-trials.json).
- [Summary, per-language metrics, known error budgets, and input hashes](all-languages/summary.json).

Verification: `make check`, `make daemon-check`, and `make agent-check`. Core
embedding/search model tests skip without model weights. The in-app guide
documents setup, repo selection, linking evidence, and current language limits.
