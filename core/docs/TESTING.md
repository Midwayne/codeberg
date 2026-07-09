# Testing the C core

Unit and integration tests live under `core/test/` and `core/cmd/cberg-index/`.
They run via CTest from the repo root:

```sh
make test                    # all tests
make test TEST=test_chunker  # one binary
make check                   # build + test (CI gate)
```

---

## Test binaries

| Binary | Location | What it exercises |
|--------|----------|-------------------|
| `test_smoke` | `test/` | `cberg_version`, `cberg_status_str` |
| `test_hash` | `test/` | `cberg_hash` |
| `test_lang` | `test/` | `cberg_language_from_path` |
| `test_config` | `test/` | `CODEBERG_ROOT` / `cberg_config_resolve_index_root` |
| `test_chunker` | `test/` | Parse, symbols, window fallback |
| `test_chunk_table` | `test/` | Sync add/modify/delete, save/load round-trip |
| `test_graph` | `test/` | Graph apply / query / trace / confidence / persistence |
| `test_graph_extract` | `test/` | Per-language graph captures (incl. Ruby require) |
| `test_graph_resolve` | `test/` | Import rewrite safety (stdlib, Go module path, TS, Rust) |
| `test_fingerprint` | `test/` | Order-independent set digest |
| `test_manifest` | `test/` | Merkle build, diff, incremental rebuild |
| `test_watch` | `test/` | Dirty path on file write |
| `test_watch_events` | `test/` | Delete-before-drain (macOS FSEvents regression) |
| `test_index` | `test/` | usearch harness + `expansion_search` restore test |
| `test_qdrant_json` | `test/` | Qdrant REST JSON parser (`json_mini`) |
| `test_index_providers` | `test/` | usearch + optional qdrant/pgvector at dim 4 and 768 |
| `test_embed` | `test/` | ONNX embedding pipeline |
| `test_search` | `test/` | `cberg_search_query` end-to-end |
| `test_cberg_walk` | `cmd/cberg-index/` | Walk policy, skip directories |
| `test_cberg_engine` | `cmd/cberg-index/` | Multi-root engine bootstrap + step + graph IPC |

---

## Environment variables

| Variable | Tests | Purpose |
|----------|-------|---------|
| `CBERG_TEST_MODEL` | `test_embed`, `test_search` | Path to ONNX `model.onnx` |
| `CBERG_TEST_QDRANT_URL` | `test_index_providers` | Qdrant base URL (e.g. `http://127.0.0.1:6333`) |
| `CBERG_TEST_POSTGRES_URL` | `test_index_providers` | PostgreSQL URL with pgvector extension |
| `LD_LIBRARY_PATH` | ONNX tests | Directory containing `libonnxruntime.so` |
| `CODEBERG_ROOT` | Some integration tests | Index root when exercising config helpers |

### SKIP 77 (optional ONNX)

`test_embed` and `test_search` exit with code **77** when `CBERG_TEST_MODEL` is unset.
CTest reports these as skipped — CI runs without ONNX by default.

To run embedding tests locally:

```sh
scripts/fetch-model.sh
export CBERG_TEST_MODEL=models/jina-embeddings-v2-base-code/model.onnx
export LD_LIBRARY_PATH="/opt/onnxruntime/lib:${LD_LIBRARY_PATH:-}"  # if needed
make test TEST=test_embed
make test TEST=test_search
```

### Index provider integration

`test_index_providers` always runs the usearch suite. Qdrant and pgvector run when
`CBERG_TEST_QDRANT_URL` and `CBERG_TEST_POSTGRES_URL` are set (otherwise those
sections are skipped with a message).

```sh
make test-index-providers   # starts Docker qdrant + pgvector when URLs unset
# or with existing services:
export CBERG_TEST_QDRANT_URL=http://127.0.0.1:6333
export CBERG_TEST_POSTGRES_URL=postgresql://postgres:test@127.0.0.1:5432/codeberg
make test TEST=test_index_providers
```
 pass `-DONNXRUNTIME_ROOT=...` to CMake (see
[AGENTS.md](../../AGENTS.md) or root [README.md](../../README.md)).

---

## Platform notes

- **Watch tests** create temp directories and may behave differently per backend
  (FSEvents, inotify, mtime poll). `test_watch_events` documents a macOS-specific
  delete-before-drain edge case.
- **Chunk-only builds** (no ONNX/usearch) still run most tests; index/embed/search
  tests return `CBERG_ERR_NOT_IMPLEMENTED` or SKIP 77.

---

## Writing new tests

Follow the existing pattern in `core/test/`:

1. One `main()` per binary, registered in `core/test/CMakeLists.txt`.
2. Use `CHECK` / `CHECK_EQ` macros from `test_common.h` (or local copies).
3. Test the **public ABI** (`codeberg.h`) — not static helpers.
4. For behavior that needs a model, gate on `getenv("CBERG_TEST_MODEL")` and
   `exit(77)` when unset (CTest skip convention).

Run a single binary directly for faster iteration:

```sh
./core/build/test/test_chunk_table
```
