# libcodeberg documentation

Complete reference for the C indexing core.

## Start here

| Document | Audience | Contents |
|----------|----------|----------|
| [CORE.md](CORE.md) | Everyone | Architecture, design principles, end-to-end flows, build |
| [API.md](API.md) | Integrators | Every public function in `codeberg.h` |
| [modules/](modules/) | Contributors | Every source file and internal function |

## Architecture decision records

| ADR | Topic |
|-----|--------|
| [adr/0001-standalone-c-core.md](adr/0001-standalone-c-core.md) | C library as the indexing engine |
| [adr/0002-watcher-driven-indexing.md](adr/0002-watcher-driven-indexing.md) | Watcher-only incremental indexing |

## Module reference (implementation)

| Module | Path | Doc |
|--------|------|-----|
| Common | `src/common/` | [modules/common.md](modules/common.md) |
| Chunking & diff | `src/chunk/` | [modules/chunk.md](modules/chunk.md) |
| Filesystem watch | `src/watch/` | [modules/watch.md](modules/watch.md) |
| Embedding | `src/embed/` | [modules/embed.md](modules/embed.md) |
| Vector search | `src/search/` | [modules/search.md](modules/search.md) |

## Public header

[`include/codeberg/codeberg.h`](../include/codeberg/codeberg.h) — sole stable ABI.

## Tests

| Binary | Exercises |
|--------|-----------|
| `test_smoke` | Version, status strings |
| `test_chunker` | Parse + hash bodies |
| `test_chunk_table` | Sync add/modify/delete |
| `test_fingerprint` | Order-independent digest |
| `test_watch` | Dirty paths on file write |
| `test_index` | usearch add/search/save |
| `test_embed` | ONNX embed (needs `CBERG_TEST_MODEL`) |
| `test_search` | End-to-end semantic query |

Run from repo root: `make test` or `make test TEST=test_chunker`.
