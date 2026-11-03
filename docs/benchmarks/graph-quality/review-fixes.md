# Graph review fixes

Measured on 2026-11-04, Apple M4, macOS arm64, Release build, without embeddings,
LLM, LSP, or network access. This extends the [November 3 evaluation](all-languages.md)
with four regression scenarios developed from review findings. It is a small,
implementation-developed regression corpus, not an independent accuracy estimate.

## Same-corpus comparison

Both runs use the same final evaluator and **37 scenarios / 82 annotated sites**:
73 expected edges and nine negative sites, across nine source languages. The
before library was frozen immediately before the review fixes; it includes the
previous graph and multi-repo implementation. This is not a comparison against
the original parent commit.

| Metric | Before review fixes | After review fixes |
| --- | ---: | ---: |
| Correct edges | 65 | 70 |
| Incorrect edges | 10 | 8 |
| Missed edges | 8 | 3 |
| Precision | 86.7% | 89.7% |
| Recall | 89.0% | 95.9% |
| F1 | 87.8% | 92.7% |

The nine new positive sites cover inner function definitions hiding outer
parameters in TypeScript, JavaScript, and Python, plus TypeScript local class
constructor/instance/static calls hiding a same-name import. They improve from
4 correct / 2 incorrect / 5 missed edges to 9 correct / 0 incorrect / 0 missed.
Every scenario must retain identical scores after saving and reloading its graph.

The existing 73 sites retain their previous 61 correct / 8 incorrect / 3 missed
edges. Java/Kotlin/Rust/Ruby receiver ambiguity accounts for the eight incorrect
edges; TypeScript function-value aliases, default imports, and re-export chains
account for the three misses. Their explicit budgets remain unchanged.

## Additional regression checks

The three-root workspace engine test additionally checks:

- A package whose missing `types` entry accompanies a valid `import` or `module`.
- An indexed declaration file alongside an implementation entry, including `main`.
- Explicitly blocked or unexported package roots remaining unresolved.
- Local TypeScript constructor, instance, and static calls staying in the importer
  repository when a same-name imported class exists in the provider.

These are assertion-based regression checks. The original nine-language
cross-repo test still checks one positive and one decoy per language; neither
suite establishes broad multi-repo linking accuracy.

A daemon regression test verifies that truncated graph edges survive lexical
search failure, with both source errors and `limit_reached` reported. Graph
snapshot version 4 forces caches using the earlier scope semantics to rebuild;
version 1/2/3 rejection and version 4 round trips are tested. The public C ABI
and chunk/vector formats are unchanged.

The second review found and fixed an additional daemon issue: impact traces
now use each changed symbol's resolved repository, so an omitted request repo
does not make same-name/path symbols in other roots cause an ambiguous trace.
A regression test checks both the selected trace scope and retained foreign impact.

## Reproduce

```sh
cmake --build core/build --target test_graph_quality test_workspace_graph -j4
core/build/test/test_graph_quality
core/build/cmd/cberg-index/test_workspace_graph
(cd daemon && go test ./internal/tools)
```

The [original report's relinking recipe](README.md#reproduce) runs the same final
evaluator against a frozen library. This run used
`/tmp/codeberg-graph-before-review-fixes.a`, a session snapshot whose checksum is
recorded below. That archive is not committed; retain it to reproduce the exact
before state. Select the frozen manifest with `CBERG_GRAPH_QUALITY_CASES` when
future scenarios are added. No performance improvement is claimed.

- [Before scores](review-fixes/before.jsonl), [after scores](review-fixes/current.jsonl).
- [Frozen scenario manifest](review-fixes/cases.txt).
- [Summary, library checksums, and evaluator/corpus hashes](review-fixes/summary.json).

Verification: `make check`, `make daemon-check`, and `make agent-check` passed.
The two model-dependent core tests skip without embedding model weights.
