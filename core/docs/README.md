# libcodeberg documentation

Complete reference for the C indexing core.

## Start here

| Document | Audience | Contents |
|----------|----------|----------|
| [CORE.md](CORE.md) | Everyone | Architecture, design principles, end-to-end flows, build |
| [API.md](API.md) | Integrators | Every public function in `codeberg.h` |
| [CBERG_INDEX.md](CBERG_INDEX.md) | Operators | `cberg-index` binary — env, lifecycle, on-disk layout |
| [TESTING.md](TESTING.md) | Contributors | CTest binaries, SKIP 77, ONNX setup |
| [modules/](modules/) | Contributors | Every source file and internal function |

## Architecture decision records

| ADR | Topic |
|-----|--------|
| [adr/0001-standalone-c-core.md](adr/0001-standalone-c-core.md) | C library as the indexing engine |
| [adr/0002-watcher-driven-indexing.md](adr/0002-watcher-driven-indexing.md) | Watcher-only incremental indexing |
| [adr/0003-merkle-manifest-change-detection.md](adr/0003-merkle-manifest-change-detection.md) | Merkle manifest for many-repo scale |
| [adr/0004-multi-root-engine.md](adr/0004-multi-root-engine.md) | Multi-root `cberg-index` engine |

## Module reference (implementation)

| Module | Path | Doc |
|--------|------|-----|
| Common | `src/common/` | [modules/common.md](modules/common.md) |
| Chunking & diff | `src/chunk/` | [modules/chunk.md](modules/chunk.md) |
| Merkle manifest | `src/manifest/` | [modules/manifest.md](modules/manifest.md) |
| Filesystem watch | `src/watch/` | [modules/watch.md](modules/watch.md) |
| Embedding | `src/embed/` | [modules/embed.md](modules/embed.md) |
| Vector search | `src/search/` | [modules/search.md](modules/search.md) |

## Public header

[`include/codeberg/codeberg.h`](../include/codeberg/codeberg.h) — sole stable ABI.

## Tests

See [TESTING.md](TESTING.md) for the full list. Quick reference:

| Binary | Exercises |
|--------|-----------|
| `test_smoke` | Version, status strings |
| `test_chunker` | Parse + hash bodies |
| `test_chunk_table` | Sync add/modify/delete, persistence |
| `test_manifest` | Merkle build, diff, incremental rebuild |
| `test_fingerprint` | Order-independent digest |
| `test_watch` | Dirty paths on file write |
| `test_index` | usearch add/search/save |
| `test_embed` | ONNX embed (needs `CBERG_TEST_MODEL`) |
| `test_search` | End-to-end semantic query |
| `test_cberg_engine` | Multi-root engine |

Run from repo root: `make test` or `make test TEST=test_chunker`.
