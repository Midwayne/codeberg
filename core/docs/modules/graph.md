# Module: `src/graph/`

RAM-first **knowledge graph** beside the chunk/vector index
([ADR 0005](../adr/0005-dual-index-graph.md)). The same tree-sitter parse that
produces chunks also emits a per-file graph fragment; `cberg-index` applies
fragments incrementally and persists a `.graph` sidecar.

**Files**

| File | Role |
|------|------|
| `graph_store.c` | In-memory store, query, trace, hubs, save/load, import rewrite helper |
| `graph_extract.c` | Per-language tree-sitter reference queries → fragment |
| `scope_*.c`, `scope_internal.h` | Go/TS/JS bindings, C/Python lexical scope, receiver types, import aliases |
| `resolve_relative.c` | Importer-relative paths, entrypoints, JS-to-TS source specifiers |
| `workspace_graph.h` | Private query-view cloning, original repo/ID/path provenance, revision counters |
| `resolve_pkg.c` | Phase 2: manifest + path heuristics → rewrite IMPORTS to FILE |
| `graph_internal.h` | Fragment / extractor / rewrite internals |

**Depends on:** `common/arena`, `common/binio`, `common/strmap`, `common/u64map`,
`common/hash`, `common/fileio`, `common/pathutil`, walk policy, tree-sitter
(via chunker).

Public ABI: `cberg_graph_*` and `cberg_chunker_analyze` in
[../API.md](../API.md) / `codeberg.h`.

---

## Pipeline

```mermaid
flowchart LR
  SRC[Source file] --> ANALYZE["cberg_chunker_analyze"]
  ANALYZE --> CHUNKS[chunk list]
  ANALYZE --> FRAG[graph fragment]
  CHUNKS --> SYNC[chunk table sync]
  SYNC --> APPLY["cberg_graph_apply"]
  FRAG --> APPLY
  APPLY --> STORE[(RAM graph)]
  STORE --> SAVE[".graph sidecar"]
  STORE --> RESOLVE["cberg_graph_resolve_imports"]
  RESOLVE --> STORE
```

1. **Extract** — one parse; symbol chunks become fragment defs; queries capture
   calls / imports / inherits / membership.
2. **Apply** — replace that file’s subgraph; resolve def keys → chunk ids.
3. **Resolve imports** (after bootstrap / rebuild) — rewrite safe IMPORTS onto
   FILE nodes with `resolution=import`.
4. **Query** — `find_nodes`, `edges_from` / `edges_to`, `trace`, `hubs`.
5. **Persist** — atomic dump; warm restart loads without re-embedding.

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
| `IMPORTS` | File → Module (or File → File after resolve) | yes |
| `CALLS` | caller → callee (name-resolved at query time) | yes (name refs) |
| `INHERITS` | subtype → supertype | yes (name refs) |
| `REFERENCES` | Non-call symbol uses, including callbacks and type names (Go/TS/JS) | yes |

Every resolved edge carries:

- `resolution` — `textual` (name match), `import` (manifest/path rewrite), later `typed`
- `confidence` — see ladder below
- `line` — reference site in the source file (0 if unknown)

### Query-time name resolution

Cross-file call/reference/inherit records retain names. `edges_from` /
`edges_to` / `trace` resolve them against the live definition index. Local lexical
bindings can store a direct chunk id; queries still require a live target.

Go/TS/JS calls and non-call references carry private binding constraints:
local declaration, package directory, named/namespace import, known receiver
type, or unresolved. An unknown receiver does not fan out to all same-name
methods. Nearest lexical bindings take precedence: parameters and local values shadow outer imports/functions, while inner functions and classes hide outer values/imports. Local class types and static receivers resolve before imports; ordinary nested
JS functions do not inherit `this`, while arrows do. Simple same-file class
inheritance follows at most eight levels and stops at the nearest override.
Other languages retain legacy name matching. These constraints do not constitute
compiler or LSP type analysis.

C and Python additionally resolve local function definitions and parameter
shadowing; Java/Kotlin/Rust/Ruby receiver matching remains name-based. The
[all-language evaluation](../../../docs/benchmarks/graph-quality/all-languages.md)
counts incorrect receiver edges rather than treating their presence as success.

Relative imports normalize from the source file's directory, reject repository
escapes, and accept unique file/entrypoint matches. Explicit `.js`/`.jsx` imports
can map to `.ts`/`.tsx` sources. Ambiguity stays unresolved. Cache invalidation
restores original import spellings before resolution, allowing unchanged
importers to follow a target moved from `util.ts` to `util/index.ts`.

## Confidence ladder (textual)

| Case | Confidence |
|------|------------|
| Exact / pre-resolved (same-file CONTAINS, DEFINES, etc.) | `1.0` |
| Same-file name match | `0.90` |
| Unique cross-file match | `0.75` |
| Ambiguous (`n` candidates) | `0.75 · min(1, 3/n)` |
| Import-resolved FILE target | `0.95` |
| Fan-out cap | at most **8** candidates per reference |

These confidence values are heuristics, not calibrated probabilities. Imported
symbol calls retain the candidate confidence ladder; `0.95` applies to the
resolved FILE import edge. Agents must treat syntactic edges as evidence to
verify, rather than a complete compiler-derived call graph.

---

## Extraction (`graph_extract.c`)

`cberg_chunker_analyze` runs one parse and returns chunks + an optional
`cberg_graph_fragment`. Languages without tree-sitter (markdown, YAML/TOML/JSON,
unknown) yield a `NULL` fragment.

Reference queries cover nine grammar languages: Go, C, Python, TypeScript,
JavaScript, Java, Kotlin, Rust, Ruby — calls, imports, inheritance, plus Go
receiver / Rust impl membership as reversed `CONTAINS`. Ruby
`require` / `require_relative` become `IMPORTS`. `CONTAINS` among same-file
symbols also comes from chunk span nesting.

Capture vocabulary:

| Capture | Meaning |
|---------|---------|
| `@call` | Callee identifier at a call site |
| `@reference` | Non-call identifier/type/member use, filtered to exclude declarations and import bindings |
| `@import` | Import path / module string (quotes stripped) |
| `@inherit` | Supertype / implemented interface name |
| `@member.container` + `@member.name` | Out-of-body membership → reversed CONTAINS |
| `@require.method` + `@require.path` | Ruby require → IMPORTS |

---

## Persistence

Binary sidecar next to the chunk table:

| Artifact | Magic / version | Contract |
|----------|-----------------|----------|
| `<index_path>.graph` | versioned binary via shared `binio.h` | atomic temp+rename; absent or incompatible → `CBERG_ERR_NOT_FOUND` → rebuild from source |

Same layout as `.chunks` / `.manifest` under `CBERG_INDEX_PATH.<roothash>`.
When `CBERG_INDEX_PATH` is set **without** `CBERG_MODEL`, sidecars (including
`.graph`) are still written so chunk-only warm restart can reload the graph.

Graph format **v4** retains binding mode, import spelling, and receiver context
and invalidates older extraction semantics. Version-1/2/3 snapshots request a cold rebuild. Public C ABI and chunk/vector
formats are unchanged. Save/load and compaction preserve the new context.

On compaction, MODULE nodes with no live IMPORTS importers are dropped
(orphan GC). Tombstoned refs from import rewrites are compacted when dead
entries dominate.

---

## Indexer env

| Variable | Default | Purpose |
|----------|---------|---------|
| `CBERG_GRAPH` | on | Kill-switch: `0` / `off` / `false` disables graph |
| `CBERG_GRAPH_MODE` | `fast` | Only `fast` (syntactic) implemented; other values warn and fall back |
| `CBERG_INDEX_PATH` | — | Base path for `.chunks` / `.manifest` / `.graph` (and vectors when model set) |

Graph failures log a warning and never block the chunk/vector pipeline.

## Multi-repository query view

The indexer keeps each repository's graph and sidecars independent. With several
configured roots, structural search, references, traces, and hubs use a cached
combined view (`cmd/cberg-index/workspace_graph.c`, `workspace_resolve.c`).
Internal IDs and paths are namespaced; responses restore native IDs/relative
paths and carry repository keys. Edges include `src_repo` and `dst_repo`.
An ID or relative path alone is not a workspace-wide identity.

`repo` restricts starting nodes; traversal and incoming references can cross
import-backed links. Omitted repo searches all roots. A trace whose matching
start nodes span multiple roots requires an explicit repo. Architecture counts
sum all roots when repo is omitted. Hubs and blast-radius results retain repo
identity during ranking and deduplication.

Workspace linking uses configured roots only: Go module manifests; JS package
names and source entrypoints (available implementations before declarations, skipping unavailable entries and respecting blocked exports); explicit relative includes/requires; Python module
paths; Java/Kotlin declared packages and symbols; simple Cargo package/use paths
with default library/module layouts. Ambiguous cross-root providers remain
unresolved. Legacy languages can follow name matches within an imported target
file; this still permits method ambiguity and is not type checking. No LSP,
build-system linker, RPC, or external package registry is consulted.

The view costs extra RAM and first-query construction. It is reused while
source graph pointers/revisions and `go.mod`, `package.json`, and `Cargo.toml`
metadata stay unchanged. Refreshes lock source repositories in configuration
order; queries serialize under a separate workspace mutex. The view is not
persisted and does not alter the public C ABI or per-repo snapshot format.

---

## Incremental semantics

1. Dirty path → `cberg_chunker_analyze` → chunk-table sync → `cberg_graph_apply`
   (replace that file’s subgraph).
2. Deleted path → `cberg_graph_remove_file` (nodes + refs for that path).
3. After cold/warm bootstrap and full rebuilds → `cberg_graph_resolve_imports`.
4. Warm restart → load `.graph`, or re-extract from source without re-embedding
   when the sidecar is missing/stale.

---

## Import resolution (`resolve_pkg.c`)

`cberg_graph_resolve_imports(graph, repo_root)` walks the repo for source files,
reads `go.mod` for the module path when present, maps path-derived import keys
for JS/TS/Python/Rust sources, and rewrites **MODULE**-targeting IMPORTS onto
FILE nodes with `resolution=import` (confidence 0.95).

**Candidates (safe shapes only):**

| Shape | Example | Notes |
|-------|---------|-------|
| Relative | `./helper`, `../lib/x` | Always eligible |
| Rust path | `crate::helper` | `::` present |
| Go module-prefixed | `example.com/app/pkg` | Must match `go.mod` module path |
| Multi-segment dotted | `pkg.sub.mod` | Python-style |
| Source-file path | `foo/bar.h` | Extension must look like source |

**Never rewritten:** bare identifiers (`fmt`, `json`, `os`) and slash-form
stdlib / npm packages (`encoding/json`, `react-dom/client`) unless they match
a Go module prefix. Package/crate `name` fields are **not** mapped onto the
first source file.

Already-resolved FILE imports are left alone (idempotent). Unresolved imports
keep their MODULE target. Per-file IMPORTS enumeration is sized from the live
ref count (not a fixed 64-slot buffer). Tests: `core/test/test_graph_resolve.c`.

`cberg_graph_hubs` ranks symbols by full incident `CALLS` degree (in+out,
uncapped) for architecture overviews (IPC `graph_hubs`). Degree is tallied in
one pass over live CALLS refs (name refs resolve once), not by re-emitting
edges per node.

---

## IPC / tools

`cberg-index` commands (see [daemon/docs/ipc.md](../../../daemon/docs/ipc.md)):

| Command | Role |
|---------|------|
| `search_graph` | Exact-name node search |
| `trace_path` | BFS over edge kinds / directions (default `both`); optional component-aware `path_prefix` |
| `graph_stats` | Node/ref counts + FILE language mix by extension |
| `graph_hubs` | CALLS degree hubs |
| `graph_refs` | Incoming edges for `find_references` |

Disabled graph → error string `graph disabled` (`NOT_IMPLEMENTED` / HTTP 501).

Daemon tools ([daemon/docs/http.md](../../../daemon/docs/http.md)):

| Tool | Behavior |
|------|----------|
| `search_graph` / `trace_path` | Locate definitions and follow source relationships; trace forwards starting `repo`/`path_prefix`; agent-facing descriptions explain direction, scope, and partial coverage |
| `detect_changes` | Git diff → hunk-overlapping symbols → 1–2 hop blast radius; sets `fallback` / `diff_spec` when the requested range fails |
| `get_architecture` | Stats + language mix + real hubs + entrypoint heuristics; surfaces hub errors |
| `find_references` | Combines graph edges and additional lexical matches; returns partial/limit/source-error coverage metadata |

Agent policy: **meaning → search; structure → graph; exact string → grep**.

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

## Tests

| Binary | Coverage |
|--------|----------|
| `test_graph` | Apply / query / trace / confidence / persistence |
| `test_graph_extract` | Per-language captures (incl. Ruby require) |
| `test_graph_resolve` | Stdlib non-rewrite, slash-stdlib decoy, Go module path, TS relative, Rust `crate::` |
| `test_graph_quality` | Hand-labelled sites in all nine source languages, wrong/missed edges, negatives, known error budgets, snapshot round-trips |
| `test_graph_scope_lifecycle` | Moved target followed by unchanged importer; alias reindex with cached resolution |
| `test_workspace_graph` | All nine source languages across three roots; unrelated providers, native identities, two-hop traces, ambiguity, manifest invalidation, deletion, cached-view timing |
| `test_cberg_engine` | IPC round-trips for graph commands |

Daemon: `graphtools_test.go`, `indextools_test.go`, `reference_coverage_test.go`.
Measured baseline, current quality, and five-trial overhead:
[graph quality report](../../../docs/benchmarks/graph-quality/README.md).

---

## Known limitations

- Go/TS/JS function-value aliases, default exports/imports, and re-export chains
  are not followed. Unknown and dynamically computed receivers remain unresolved.
- Go package identity uses directory membership; external test packages in the
  same directory are not distinguished. Implicit imported package names assume
  the final module path segment. Interfaces, generics, flow-sensitive assignments,
  destructured bindings, and cross-file inheritance need deeper type analysis.
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
