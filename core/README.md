# Codeberg core

`libcodeberg` — the C indexing engine.

**Documentation:** [docs/README.md](docs/README.md) (index) · [docs/API.md](docs/API.md) (public API) · [docs/CORE.md](docs/CORE.md) (architecture)

## Build

```sh
git submodule update --init --recursive
make build
```

Artifacts: `build/libcodeberg.a`, `build/libcodeberg.pc`.

### Source layout

```
src/common/   shared utilities (arena, hash/xxhash, pathutil, …)
src/chunk/    tree-sitter chunker + chunk table
src/watch/    filesystem watcher
src/embed/    ONNX embedder + tokenizer
src/search/   usearch index + query search
```

## Modules

| Module | API | Purpose |
|--------|-----|---------|
| Chunker | `cberg_chunker_*` | Tree-sitter parsing into functions, types, etc. |
| Chunk table | `cberg_chunk_table_*` | Incremental add/modify/delete diff with stable ids |
| Fingerprint | `cberg_fingerprint` | Whole-set change summary |
| Watcher | `cberg_watcher_*` | Filesystem events — the indexing trigger |
| Embedder | `cberg_embedder_*` | ONNX jina embeddings (optional at build time) |
| Vector index | `cberg_index_*` | usearch HNSW cosine search by chunk id |
| Search | `cberg_search_query` | Embed query text + nearest-neighbor lookup |

### Optional ONNX model (embedding tests)

Install [ONNX Runtime](https://onnxruntime.ai/) and place **jina-embeddings-v2-base-code** (`model.onnx` + `tokenizer.json` in the same directory). Run embedding tests with:

```sh
export CBERG_TEST_MODEL=/path/to/model.onnx
make test TEST=test_embed
```

Or run `scripts/fetch-model.sh` to download jina-embeddings-v2-base-code into `models/`.
