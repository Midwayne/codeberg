# Module: `src/graph/`

RAM-first **knowledge graph** beside the chunk/vector index (ADR 0005). Same
tree-sitter parse that produces chunks also emits a per-file graph fragment;
`cberg-index` applies fragments incrementally and persists a `.graph` sidecar.

**Files:** `graph_store.c`, `graph_extract.c`, `graph_internal.h`  
**Depends on:** `common/arena`, `common/binio`, `common/strmap`, `common/u64map`,
`common/hash`, tree-sitter (via chunker)

Public ABI: `cberg_graph_*` and `cberg_chunker_analyze` in
[../API.md](../API.md) / `codeberg.h`.

---

## Schema

### Nodes (`cberg_graph_node`)

| Kind | Id space | `name` / `qname` / `path` |
|------|----------|---------------------------|
| `FILE` | synthetic (top bit set) | basename / repo-relative path / path |
| `FUNCTION` / `METHOD` / `CLASS` / `STRUCT` / `INTERFACE` | **stable chunk id** | symbol / chunk key / defining file |
| `MODULE` | synthetic | import string / same / `NULL` |

Symbol nodes reuse chunk ids via `cberg_chunk_table_find_by_key` at apply time,
so graph, chunk table, and vectors stay aligned across edits.

### Edges (`cberg_graph_edge`)

| Kind | Meaning | Stored? |
|------|---------|---------|
| `DEFINES` | File → symbol | **Synthesized** at query time from live nodes |
| `CONTAINS` | Type → member (span nesting; Go receiver / Rust impl reversed) | yes (as refs) |
| `IMPORTS` | File → Module | yes |
| `CALLS` | caller → callee (name-resolved) | yes (name refs) |
| `INHERITS` | subtype → supertype | yes (name refs) |
| `REFERENCES` | reserved | yes |

Every resolved edge carries:

- `resolution` — `textual` (Phase 1), later `import` / `typed`
- `confidence` — see ladder below
- `line` — reference site in the source file (0 if unknown)

### Query-time name resolution

Call/inherit references store a **name**, not a hard id. `edges_from` /
`edges_to` / `trace` resolve names against the live definition index, so
deleting a file can never leave a dangling edge.

---

## Confidence ladder (textual)

Ported from DeusData/codebase-memory-mcp (MIT — see repo `THIRD_PARTY.md`):

| Case | Confidence |
|------|------------|
| Exact / pre-resolved (same-file CONTAINS, etc.) | `1.0` |
| Same-file name match | `0.90` |
| Unique cross-file match | `0.75` |
| Ambiguous (`n` candidates) | `0.75 · min(1, 3/n)` |
| Fan-out cap | at most **8** candidates per reference |

Agents must treat `resolution=textual` as a hint, not go-to-definition.

---

## Extraction (`graph_extract.c`)

`cberg_chunker_analyze` runs one parse and returns chunks + an optional
`cberg_graph_fragment`. Languages without tree-sitter (markdown, YAML/TOML/JSON,
unknown) yield a `NULL` fragment.

Reference queries cover all nine grammar languages: Go, C, Python, TypeScript,
JavaScript, Java, Kotlin, Rust, Ruby — calls, imports, inheritance, plus Go
receiver / Rust impl membership as reversed `CONTAINS`. `CONTAINS` among
same-file symbols also comes from chunk span nesting.

---

## Persistence

Binary sidecar next to the chunk table:

| Artifact | Magic / version | Contract |
|----------|-----------------|----------|
| `<index_path>.graph` | versioned binary via shared `binio.h` | atomic temp+rename; absent or incompatible → `CBERG_ERR_NOT_FOUND` → rebuild from source |

Same layout as `.chunks` / `.manifest` under `CBERG_INDEX_PATH.<roothash>`.
When `CBERG_INDEX_PATH` is set **without** `CBERG_MODEL`, sidecars (including
`.graph`) are still written so chunk-only warm restart can reload the graph.

---

## Indexer env

| Variable | Default | Purpose |
|----------|---------|---------|
| `CBERG_GRAPH` | on | Kill-switch: `0` / `off` / `false` disables graph |
| `CBERG_GRAPH_MODE` | `fast` | Only `fast` (syntactic) implemented; other values warn and fall back |
| `CBERG_INDEX_PATH` | — | Base path for `.chunks` / `.manifest` / `.graph` (and vectors when model set) |

Graph failures log a warning and never block the chunk/vector pipeline.

---

## Incremental semantics

1. Dirty path → `cberg_chunker_analyze` → chunk-table sync → `cberg_graph_apply`
   (replace that file’s subgraph).
2. Deleted path → `cberg_graph_remove_file` (nodes + refs for that path).
3. Warm restart → load `.graph`, or re-extract from source without re-embedding
   when the sidecar is missing/stale.

---

## Import resolution (Phase 2)

`cberg_graph_resolve_imports(graph, repo_root)` scans `go.mod`, `package.json`,
`pyproject.toml`, and `Cargo.toml`, plus relative path heuristics, and rewrites
`IMPORTS` edges that map onto a repo FILE node with `resolution=import`
(confidence 0.95). Only relative (`./` `../`), Rust `::` paths, Go
module-prefixed imports, multi-segment dotted names, or source-file paths are
candidates — bare identifiers and slash-form stdlib/npm packages (`fmt`,
`encoding/json`) stay MODULE targets. Already-resolved FILE imports are left
alone (idempotent). Unresolved imports keep their MODULE target. The indexer
runs this after cold/warm bootstrap and graph rebuilds.

`cberg_graph_hubs` ranks symbols by incident `CALLS` degree for architecture
overviews (exposed as IPC `graph_hubs`).

---

## IPC / tools

`cberg-index` commands (see [daemon/docs/ipc.md](../../../daemon/docs/ipc.md)):

| Command | Role |
|---------|------|
| `search_graph` | Exact-name node search |
| `trace_path` | BFS over edge kinds / directions (optional path_prefix) |
| `graph_stats` | Node/ref counts + FILE language mix |
| `graph_hubs` | CALLS degree hubs |
| `graph_refs` | Incoming edges for `find_references` |

Disabled graph → error string `graph disabled` (`NOT_IMPLEMENTED` / HTTP 501).

Daemon tools: `search_graph`, `trace_path`, `detect_changes` (hunk-filtered git
diff → blast radius; honest `fallback` field), `get_architecture` (hubs /
entrypoints / language mix); `find_references` is graph-first with grep fallback
and returns `{source, graph|matches}`. Agent policy:
**meaning → search; structure → graph; exact string → grep**.

---

## Self-index timing (this repo)

Chunk-only cold index of the Codeberg tree with graph enabled (no ONNX), measured
on the cloud agent VM (2026-07-09). Wall-clock is `cberg-index` bootstrap until
ready; warm restart loads the `.graph` sidecar (no re-embed).

| Run | Wall time | Scale |
|-----|-----------|-------|
| Cold graph build | **~87 s** | ~251k chunks, ~19.6k nodes, ~82.6k refs (includes vendored `third_party/` grammars) |
| Warm restart (load `.graph`) | **~0.73 s** | same sidecars; `warm restart: 0 added/modified/deleted` |

`search_graph` / `trace_path` on `cberg_chunker_parse` returned plausible callers
(e.g. `test_chunker.c` fixtures) with `resolution=textual`. Average application
repos without vendored grammar trees should land closer to the “seconds”
structural-path target; this tree is an outlier because of `core/third_party/`.

Microbenchmarks: [bench_graph](../../bench/bench_graph.c) (apply/remove churn,
`edges_to` hub, BFS trace, save/load).

---

## Known limitations

- Kotlin extension/infix call shapes are incomplete in `fast` mode.
- Rust: trait-impl `INHERITS` (`impl Trait for Type`) deferred to typed mode.
- Symbol `qname` is the chunk key, not a package-qualified name (improves as
  import resolution maps packages → files).
- Hybrid LSP / `CBERG_GRAPH_MODE=moderate|full` not implemented yet (env warns
  and falls back to `fast`).
- Self-index cold time on this monorepo is dominated by vendored grammar trees
  under `core/third_party/` (~250k chunks); application repos should be much
  smaller.
- Module orphans are dropped on compaction when they have no live IMPORTS.
