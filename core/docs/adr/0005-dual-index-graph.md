# 5. Dual index: chunks/vectors + knowledge graph

Status: accepted

## Context

Codeberg today indexes a repository into **semantic chunks**, optionally
**embeds** them, and serves **vector / hybrid search** plus symbol lookup tools.
That is strong for agentic “find relevant code” workflows and weak for
structural questions (callers, blast radius, architecture).

[DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)
shows that a tree-sitter-derived **knowledge graph** answers those structural
questions with far fewer tokens, and that a RAM-first structural index can be
very fast. Their product is graph-first; ours is retrieval-first. We want
**both**.

Constraints from prior ADRs:

- Performance-critical indexing stays in C (`0001`).
- Updates are watcher-driven (`0002`).
- Manifest complements watching at scale (`0003`).
- Multi-root: one process, per-root state (`0004`).

## Decision

Maintain a **dual index** inside `cberg-index`:

1. **Chunk table + optional vector index** — unchanged role (retrieval).
2. **Knowledge graph sidecar** — nodes/edges extracted from the same parse
   pass, persisted per root next to `.chunks` / `.manifest`.

Stable chunk `uint64` ids are the primary id space for symbol nodes so graph,
chunks, and vectors stay aligned across edits.

Graph construction is incremental: dirty paths from the watcher/manifest drive
re-extraction; content-hash unchanged chunks do not rebuild edges.

Modes (`CBERG_GRAPH_MODE`): `fast` (syntactic), `moderate` / `full` (import-
and type-aware resolution later). Graph may be disabled entirely via env.

Daemon exposes graph tools (`search_graph`, `trace_path`, …) alongside existing
search tools. Edges carry `confidence` and `resolution` so agents can distrust
textual links.

Detailed roadmap: [docs/full-intelligence-backend.md](../../../docs/full-intelligence-backend.md).

## Consequences

- New `cberg_graph_*` surface in `codeberg.h` and a `.graph` artifact per root.
- Indexer work per file increases (still cheap vs ONNX embed).
- We intentionally do **not** make the graph the only index or abandon hybrid
  vector search.
- Borrowing from codebase-memory-mcp is limited to MIT-compatible ports of
  algorithms/schema ideas; no wholesale replacement of our process model.
- Eval must cover structural tools as well as retrieval ([agent-accuracy.md](../../../docs/agent-accuracy.md)).
