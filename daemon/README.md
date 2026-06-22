# Codeberg daemon (Go)

Go orchestration layer over **libcodeberg**: watcher-driven indexing, optional vector
search HTTP API, and optional scheduled `git pull` for mirror refresh.

Indexing is **never** timer-driven — only filesystem events from `cberg_watcher` trigger
re-chunk and sync (see [ADR 0002](../core/docs/adr/0002-watcher-driven-indexing.md)).

## Binaries

| Binary | Role |
|--------|------|
| `cberg-index` | Bootstrap walk + watch loop → chunk → sync → (optional) embed/index |
| `codeberg-d` | Runs indexer + HTTP (`/health`, `/search`) + optional `git pull` |

## Build

```sh
make build-daemon
```

Outputs: `core/build/bin/cberg-index`, `core/build/bin/codeberg-d`.

Requires a built `libcodeberg` (`make build`), CGO, and Go 1.22+. ONNX Runtime must be
on the linker path when using vector indexing (same as core embed tests).

## Configuration

| Variable | Required | Purpose |
|----------|----------|---------|
| `CODEBERG_ROOT` | yes | Repository tree to index |
| `CBERG_MODEL` | for vectors | Path to ONNX model |
| `CBERG_INDEX_PATH` | for vectors | usearch index file path |
| `CBERG_POLL_MS` | no | Watcher poll timeout (default 1000) |
| `CODEBERG_HTTP_PORT` | no | HTTP listen port for `codeberg-d` (default 8080) |
| `CODEBERG_GIT_PULL_INTERVAL_SEC` | no | `git pull --ff-only` interval; 0 = disabled |
| `CODEBERG_GIT_DIR` | no | Git repo for pull (default `CODEBERG_ROOT`) |

Chunk-only mode (no embed/index): omit `CBERG_MODEL` and `CBERG_INDEX_PATH`.

## Run

```sh
export CODEBERG_ROOT=/path/to/repo
export CBERG_MODEL=models/jina-embeddings-v2-base-code/model.onnx
export CBERG_INDEX_PATH=/tmp/codeberg.usearch
./core/build/bin/cberg-index
```

HTTP daemon:

```sh
export CODEBERG_GIT_PULL_INTERVAL_SEC=300
./core/build/bin/codeberg-d
curl 'http://localhost:8080/search?q=add+function&k=5'
```

## Layout

```
daemon/
├── cmd/cberg-index/     indexer CLI
├── cmd/codeberg-d/      HTTP + git pull wrapper
├── internal/cberg/      CGO bindings to libcodeberg
├── internal/indexer/    bootstrap + watch orchestration
├── internal/walk/       bootstrap file walk (skip policy)
├── internal/httpserver/ minimal JSON API
└── docs/                module notes
```

See [docs/README.md](docs/README.md) for module-level detail.
