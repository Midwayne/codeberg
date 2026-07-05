# Codeberg core

`libcodeberg` — the C indexing engine.

**Documentation:** [docs/README.md](docs/README.md) (index) · [docs/API.md](docs/API.md) (public API) · [docs/CORE.md](docs/CORE.md) (architecture)

## Build

```sh
git submodule update --init --recursive
make build-core
```

Artifacts: `build/libcodeberg.a`, `build/libcodeberg.pc`.

### Source layout

```
src/common/   shared utilities (arena, hash/xxhash, pathutil, u64map, …)
src/chunk/    tree-sitter chunker + chunk table
src/manifest/ merkle manifest (watch-free change detection)
src/watch/    filesystem watcher
src/embed/    ONNX embedder + tokenizer
src/search/   usearch index + query search
cmd/cberg-index/  multi-root indexer binary
```

## Modules

| Module | API | Purpose |
|--------|-----|---------|
| Chunker | `cberg_chunker_*` | Tree-sitter parsing into functions, types, etc. |
| Chunk table | `cberg_chunk_table_*` | Incremental add/modify/delete diff with stable ids |
| Fingerprint | `cberg_fingerprint` | Whole-set change summary |
| Manifest | `cberg_manifest_*` | Merkle tree for watch-free / many-repo change detection |
| Watcher | `cberg_watcher_*` | Filesystem events — the indexing trigger |
| Embedder | `cberg_embedder_*` | ONNX jina embeddings (optional at build time) |
| Vector index | `cberg_index_*` | usearch HNSW cosine search by chunk id |
| Search | `cberg_search_query`, `cberg_search_vector` | Embed query text (or reuse an embedding) + nearest-neighbor lookup |

This library indexes and searches **one** root at a time — `cberg_search_vector`
exists so a caller can embed a query once and search it against several
indexes. Serving *multiple* roots from one process (one shared embedder, N
per-root indexes, merged search) is the `cberg-index` command's job, not the
library's: see [ADR 0004](docs/adr/0004-multi-root-engine.md) and
[../docs/multi-repo.md](../docs/multi-repo.md).

### Optional ONNX model (embedding tests)

Install [ONNX Runtime](https://onnxruntime.ai/) and place **jina-embeddings-v2-base-code** (`model.onnx` + `tokenizer.json` in the same directory). Run embedding tests with:

```sh
export CBERG_TEST_MODEL=/path/to/model.onnx
make test TEST=test_embed
```

Or run `scripts/fetch-model.sh` to download jina-embeddings-v2-base-code into `models/`.
