# Graph quality fixtures

Each directory is an independent miniature repository. `cases.txt` lists its
name, permitted missed-edge count, and optional permitted incorrect-edge count
(default zero). These are regression fixtures developed
with the resolver, not an independent held-out evaluation set.

`expected.tsv` is a manually authored target-resolution oracle with five fields:

```text
edge_kind  source_path  source_line  target_path  definition_start_line
calls      main.ts      4            dep.ts       1
calls      main.ts      9            -            0
```

Paths are relative to the scenario directory; lines are one-based. Kinds are
`calls`, `imports`, or `references`. `-` denotes an intentionally unresolved site:
emitting any destination there counts as an incorrect edge. Definition lines
refer to the start of the symbol chunk (or line zero for a FILE import target).
Comments in source help explain the oracle but are not parsed by the evaluator.

Add decoys with the same name when testing disambiguation. Keep each annotated
site on its own line. For an expected destination, extra wrong targets count as
false positives and an absent correct target counts as a false negative. Edges
outside annotated sites are not scored. Source chunk identity is not scored
separately. Duplicate captures of an identical edge tuple are counted once.

Known unsupported cases retain their real expected targets and explicit miss
budgets, rather than relabelling missing behavior as correct. Four receiver
scenarios for Java/Kotlin/Rust/Ruby currently permit two incorrect edges each;
these errors are counted in the quality report. Those budgets detect additional
regressions; passing the test does not imply perfect precision. All other
scenarios reject incorrect edges. Save/reload must preserve the same score.

Run from the repository root:

```sh
cmake --build core/build --target test_graph_quality
core/build/test/test_graph_quality
```

Use `--report-only` for a baseline comparison. The
[all-language measurement report](../../../../docs/benchmarks/graph-quality/all-languages.md) records
the parent/current results, method, runtime cost, and reproduction steps.

`CBERG_GRAPH_QUALITY_CASES` can select a different manifest, including the frozen
initial Go/TS/JS manifest in `docs/benchmarks/graph-quality/initial-cases.txt`.
The current default covers all nine source languages. The
[review-fix evaluation](../../../../docs/benchmarks/graph-quality/review-fixes.md)
adds lexical shadowing and local-class/import regressions. The workspace engine test
adds cross-repository call and unrelated-provider checks in all nine languages;
document/config chunking is checked separately in `test_graph_extract`.
