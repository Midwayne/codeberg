# 1. C library as the indexing engine

Status: accepted

## Context

Indexing a codebase requires fast, repetitive work on local data: parse millions of
lines into logical chunks, detect which chunks changed since the last pass, embed
changed text into vectors, and update a vector index. These steps share in-memory
buffers, reuse expensive parser state, and benefit from running in one process with
minimal boundary crossings.

## Decision

All performance-critical indexing logic lives in **`core/` (`libcodeberg`)** — a C11
library with a narrow public ABI (`include/codeberg/codeberg.h`).

Phase 1 already ships:

- Tree-sitter chunking with warm parser pools per language
- Per-chunk XXH3-128 content digests and incremental diff (`cberg_chunk_table`)
- Order-independent set fingerprint (`cberg_fingerprint`, XXH3 over sorted pairs)
- Recursive filesystem watching (`cberg_watcher`)

Phase 2 extends the same library with ONNX embedding and a usearch HNSW index. The
`cberg-index` CLI links the static library and runs the full watch → chunk → diff →
embed → index loop (shipped; see [0004-multi-root-engine.md](0004-multi-root-engine.md)).

Higher-level repo directories (`daemon/`, `agent/`) are separate concerns — HTTP API,
retrieval clients, and optional scheduled `git pull`. They do not trigger indexing;
see [0002-watcher-driven-indexing.md](0002-watcher-driven-indexing.md).

## Rationale

- **Tree-sitter, ONNX Runtime, and usearch are native C/C++ libraries.** Keeping the
  engine in C avoids FFI overhead on the hot path and lets one binary own parsers,
  tensors, and index pages in the same address space.
- **Chunking and watching belong together.** Filesystem events should feed directly
  into re-chunking without serializing paths across process boundaries.
- **Stable chunk IDs must survive content edits.** The chunk table assigns each key a
  permanent `uint64_t` id so vector index entries and cache files do not need
  re-keying when a function body changes.
- **Two digest roles, one algorithm family.** Per-chunk XXH3-128 drives the exact
  diff; a second XXH3-128 pass over sorted `(key, content_hash)` pairs summarizes the
  whole set for cheap “anything changed?” checks.

## Consequences

- Consumers link `libcodeberg` (or the planned `cberg-index` binary) directly.
- Implementation details — tree-sitter grammars, xxHash, ONNX, usearch — stay private;
  only `codeberg.h` is exported.
- Persistence and HTTP serving are out of scope for the core ABI; wrappers must not
  add timer-based indexing — only the watcher drives re-chunking.
