# Full intelligence backend — progress checkpoint

Status of [full-intelligence-backend.md](full-intelligence-backend.md) /
[ADR 0005](../core/docs/adr/0005-dual-index-graph.md) as of 2026-07-09.
Branch: `cursor/full-intelligence-backend-plan-eda6`.
ADR 0005: **accepted**.

## Done (this checkpoint)

**Phase 1 core library — the graph lives in `libcodeberg` beside the
chunk/vector index, fed by the same parse pass.**

| Piece | Where | Notes |
|-------|-------|-------|
| `cberg_graph_*` ABI | `core/include/codeberg/codeberg.h` | node/edge kinds, resolution + confidence on every edge, find/edges/trace/save/load |
| Graph store | `core/src/graph/graph_store.c` | RAM-first arrays + open-addressing indexes; tombstone deletes + compaction; **query-time** textual name resolution so removes never dangle |
| Confidence ladder | same | same-file 0.90, unique global 0.75, ambiguous `0.75·min(1, 3/n)`, fan-out capped at 8 — ported from DeusData/codebase-memory-mcp (MIT, see THIRD_PARTY.md) |
| Extraction | `core/src/graph/graph_extract.c` | per-language ref queries: calls, imports, inherits, Go receiver / Rust impl membership (reversed CONTAINS); CONTAINS from chunk span nesting; **all 9 tree-sitter langs** |
| One-parse integration | `cberg_chunker_analyze` | chunks + fragment from a single tree-sitter parse; `cberg_chunker_parse` is a wrapper |
| Stable ids | `cberg_chunk_table_find_by_key` | symbol nodes reuse chunk ids via chunk keys; file/module nodes are top-bit-tagged hashes |
| Persistence | `.graph` sidecar | binary snapshot, magic+version, atomic temp+rename; incompatible → `NOT_FOUND` → rebuild; shared `binio.h`; **`CBERG_INDEX_PATH` alone** (no model) still writes sidecars for warm restart |
| Indexer wiring | `core/cmd/cberg-index/indexer.c` | `CBERG_GRAPH` (default **on**), `CBERG_GRAPH_MODE=fast`; fragments after chunk sync; watcher deletes drop file subgraphs; warm load or re-extract; graph failures degrade |
| Benchmarks | `core/bench/bench_graph.c` | cold apply, apply/remove churn, `edges_to` hub, BFS trace, save/load |
| Module doc | `core/docs/modules/graph.md` | schema, confidence, env, sidecar, incremental semantics, self-index timings |
| IPC | `search_graph`, `trace_path`, `graph_stats`, `graph_refs` | repo-scoped; disabled → `graph disabled` |
| Daemon tools | `search_graph`, `trace_path`; `find_references` graph-first | resolution + confidence in output; grep fallback |
| Agent | prompt + evidence/UI | meaning → search; structure → graph; exact → grep; `agent/eval/structural-cases.jsonl` |
| Tests | `test_graph*`, engine IPC, daemon/agent unit | green on this machine |

Self-index (chunk-only, this repo incl. `third_party/`): cold **~87 s**
(~251k chunks / ~20k nodes); warm **~0.73 s**. See module doc.

Not caused by this work: `test_index_providers` may fail without libpq on some
machines — pre-existing / environment-dependent (this VM has libpq).

## Remaining

### Phase 2+ (per the plan, unchanged)

- Manifest-based import resolution (`go.mod`, `package.json`/`tsconfig`,
  `pyproject`, `Cargo.toml`) → `resolution=import`, rewrite `IMPORTS`/`CALLS`.
- `detect_changes` (git diff → symbols → 1–2 hop blast radius) and
  `get_architecture`.
- Hybrid LSP type resolution per language (Go → TS/JS → Python) →
  `resolution=typed`; `CBERG_GRAPH_MODE=moderate|full` gates it (env parsing
  already warns-and-falls-back today).
- `SIMILAR_TO` (MinHash) + vector `SEMANTICALLY_RELATED`, route/HTTP edges,
  cross-repo edges, optional Cypher subset, optional MCP stdio surface.
- Full agent eval harness runner (`codeberg-eval`) from [agent-accuracy.md](agent-accuracy.md)
  — structural cases JSONL is seeded; scoring/runner still planned.

### Known limitations to revisit

- Kotlin extraction: `navigation_expression` method calls are captured, but
  extension/infix call shapes are not — acceptable for `fast` mode.
- Ruby: no import extraction (`require` is a plain method call; needs
  argument-aware handling, predicates aren't evaluated by the C query API).
- Rust: trait-impl `INHERITS` (`impl Trait for Type`) deferred — both
  endpoints are name-only; fits the Phase 3 typed pass.
- Module nodes are never garbage-collected when their last importer goes
  away (harmless orphans; compaction hook is the natural place to fix).
- `qname` on symbol nodes is the chunk key, not a package-qualified name;
  proper qualified names arrive with Phase 2 package resolution.
- Self-index cold time on this monorepo is dominated by vendored grammar trees
  under `core/third_party/` (~250k chunks); application repos should be much
  smaller.
