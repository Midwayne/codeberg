# Full intelligence backend — progress checkpoint

Status of [full-intelligence-backend.md](full-intelligence-backend.md) /
[ADR 0005](../core/docs/adr/0005-dual-index-graph.md) as of 2026-07-09.
Branch: `cursor/full-intelligence-backend-plan-eda6`.

## Done (this checkpoint)

**Phase 1 core library — the graph lives in `libcodeberg` beside the
chunk/vector index, fed by the same parse pass.**

| Piece | Where | Notes |
|-------|-------|-------|
| `cberg_graph_*` ABI | `core/include/codeberg/codeberg.h` | node/edge kinds, resolution + confidence on every edge, find/edges/trace/save/load |
| Graph store | `core/src/graph/graph_store.c` | RAM-first arrays + open-addressing indexes; tombstone deletes + compaction; **query-time** textual name resolution so removes never dangle |
| Confidence ladder | same | same-file 0.90, unique global 0.75, ambiguous `0.75·min(1, 3/n)`, fan-out capped at 8 — ported from DeusData/codebase-memory-mcp (MIT, see THIRD_PARTY.md) |
| Extraction | `core/src/graph/graph_extract.c` | per-language ref queries: calls, imports, inherits, Go receiver / Rust impl membership (reversed CONTAINS); CONTAINS from chunk span nesting; **all 9 tree-sitter langs** (Go, C, Python, TS, JS, Java, Kotlin, Rust, Ruby) |
| One-parse integration | `cberg_chunker_analyze` | chunks + fragment from a single tree-sitter parse; `cberg_chunker_parse` is a wrapper |
| Stable ids | `cberg_chunk_table_find_by_key` | symbol nodes reuse chunk ids via chunk keys; file/module nodes are top-bit-tagged hashes |
| Persistence | `.graph` sidecar | binary snapshot, magic+version, atomic temp+rename; incompatible → `NOT_FOUND` → rebuild (chunk-table contract); shared `binio.h` helpers (chunk table refactored onto them) |
| Indexer wiring | `core/cmd/cberg-index/indexer.c` | `CBERG_GRAPH` (default **on**), `CBERG_GRAPH_MODE=fast`; fragments applied after chunk sync; watcher deletes drop file subgraphs; warm restart loads sidecar or re-extracts (no re-embed); graph failures degrade, never block chunk/vector pipeline |
| Tests | `core/test/test_graph*.c` | store queries, confidence values, BFS trace, incremental edit/delete, persistence round-trip + corrupt-snapshot fallback, per-language extraction fixtures — all green |

Not caused by this work: `test_index_providers` fails on machines without
libpq ("parse pgvector") — pre-existing, environment-dependent.

## Remaining

### Immediate (finish the checkpoint scope)

1. **Benchmarks** — `core/bench/bench_graph.c` (bench.h harness): apply/remove
   churn, name-resolution + `edges_to` on hub names, BFS trace, save/load
   throughput; add to `bench/CMakeLists.txt`.
2. **Module doc** — `core/docs/modules/graph.md`: schema (nodes/edges/ids),
   resolution + confidence table, env vars, sidecar format, incremental
   semantics; link from `modules/README.md` and `CBERG_INDEX.md`.
3. **ADR 0005** — flip `proposed` → `accepted` once the above land.
4. **Self-index validation** — run `cberg-index` on this repo chunk-only,
   confirm cold graph build time (target: seconds) and warm-restart load;
   record numbers in the module doc.
5. **`make check` sweep** on a machine with libpq to confirm the provider
   test is the only red.

### Phase 1 exit (daemon + agent surface)

6. **IPC commands** in `cberg-index` (`ipc.c`): `search_graph`, `trace_path`,
   `graph_stats` — repo-key scoped, mirroring the search command shape;
   graph disabled → clear "graph disabled" error (plan §8: 501-style hint).
7. **Daemon tools** (`daemon/`): `search_graph`, `trace_path`; upgrade
   `find_references` to graph-first with grep fallback; expose `resolution`
   + `confidence` in tool output so agents can distrust textual edges.
8. **Agent registration** (`agent/`): tool schemas + system-prompt policy
   ("meaning → search; structure → graph; exact string → grep").
9. **Structural eval cases** in `agent/eval` (callers / imports / where-defined
   golden set, plan §5 Phase 0 exit).

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
