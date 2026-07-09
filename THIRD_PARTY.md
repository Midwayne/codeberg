# Third-party notices

Vendored dependencies live under `core/third_party/` and carry their own
licenses (tree-sitter and grammar submodules, usearch, xxHash,
onnxruntime-extensions).

## Borrowed designs and algorithms

- **DeusData/codebase-memory-mcp** (MIT,
  https://github.com/DeusData/codebase-memory-mcp) — the knowledge-graph
  sidecar (`core/src/graph/`) adapts the multi-pass
  structure→definitions→calls→links pipeline shape, the node/edge label
  taxonomy, the RAM-first build with a single artifact dump, per-language
  call/import node-type tables, and the edge-confidence model (same-module
  0.90, unique-name 0.75, candidate-count penalty `min(1, 3/count)`). See
  [core/docs/modules/graph.md](core/docs/modules/graph.md) and
  [ADR 0005](core/docs/adr/0005-dual-index-graph.md). The implementation is a
  clean-room port onto the libcodeberg ABI; no source files were copied.
