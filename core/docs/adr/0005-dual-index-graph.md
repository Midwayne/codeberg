# 5. Dual index: chunks/vectors + knowledge graph

Status: accepted

## Context

Codeberg indexes a repository into **semantic chunks**, optionally **embeds**
them, and serves **vector / hybrid search** plus symbol lookup. That path is
strong for “find relevant code” and weak for structural questions (callers,
blast radius, architecture overview).

We need both retrieval and structure in one indexer process, without a second
daemon or a separate id space.

Constraints from prior ADRs:

- Performance-critical indexing stays in C (`0001`).
- Updates are watcher-driven (`0002`).
- Manifest complements watching at scale (`0003`).
- Multi-root: one process, per-root state (`0004`).

## Decision

Maintain a **dual index** inside `cberg-index`:

1. **Chunk table + optional vector index** — unchanged role (retrieval).
2. **Knowledge graph sidecar** — nodes and edges from the same tree-sitter
   parse that produces chunks, persisted per root next to `.chunks` /
   `.manifest` as `<index_path>.graph`.

Stable chunk `uint64` ids are the primary id space for symbol nodes so graph,
chunks, and vectors stay aligned across edits. File and module nodes use a
synthetic id space (top bit set).

Graph construction is incremental: dirty paths from the watcher/manifest drive
`cberg_chunker_analyze` → `cberg_graph_apply`; content-hash unchanged chunks do
not rebuild edges. Name-based call/inherit refs resolve at **query time** so
deletes never leave dangling edges.

Modes (`CBERG_GRAPH_MODE`): `fast` (syntactic, shipped), `moderate` / `full`
(import- and type-aware resolution later). Graph may be disabled via
`CBERG_GRAPH=0`.

Daemon exposes graph tools (`search_graph`, `trace_path`, `graph_stats`,
`graph_hubs`, `graph_refs`, plus `detect_changes` / `get_architecture` /
graph-first `find_references`) alongside existing search tools. Edges carry
`confidence` and `resolution` so agents can distrust textual links.

Module reference: [modules/graph.md](../modules/graph.md).

## Consequences

- New `cberg_graph_*` surface in `codeberg.h` and a `.graph` artifact per root.
- Indexer work per file increases (still cheap vs ONNX embed).
- The graph is a **sidecar**, not a replacement for hybrid vector search.
- Eval should cover structural tools as well as retrieval
  ([agent-accuracy.md](../../../docs/agent-accuracy.md)).
