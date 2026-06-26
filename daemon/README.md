# Codeberg daemon (Go)

Go orchestration layer: supervises the C **`cberg-index`** indexer, serves HTTP
(`/health`, `/search`, agent tools), and optional scheduled `git pull`.

Indexing runs entirely in **`cberg-index`** (C, links `libcodeberg`). The Go
daemon has no CGO — it talks to the indexer over a Unix socket.

## Binaries

| Binary | Role |
|--------|------|
| `cberg-index` | C — bootstrap walk + watcher loop → chunk → sync → embed → index |
| `codeberg-d` | Go — supervise indexer + HTTP + agent tools + optional `git pull` |

## Build

```sh
make build-core     # libcodeberg + cberg-index (C)
make build-daemon   # codeberg-d (pure Go)
```

Outputs: `core/build/bin/cberg-index`, `core/build/bin/codeberg-d`.

`cberg-index` requires ONNX Runtime on the linker path when using vector indexing.

## Configuration

| Variable | Required | Purpose |
|----------|----------|---------|
| `CODEBERG_ROOT` | yes | Repository tree to index |
| `CBERG_MODEL` | for vectors | Path to ONNX model |
| `CBERG_INDEX_PATH` | for vectors | usearch index **base path**; the actual index and its chunk-table/manifest sidecars are per-directory (`<base>.<roothash>[.chunks\|.manifest]`) |
| `CBERG_POLL_MS` | no | Watcher poll timeout (default 1000) |
| `CBERG_SOCKET` | no | Unix socket for indexer IPC (default `/tmp/codeberg-index.sock`) |
| `CBERG_INDEX_BIN` | no | Path to `cberg-index` binary |
| `CODEBERG_HTTP_PORT` | no | HTTP listen port (default 8080) |
| `CODEBERG_GIT_PULL_INTERVAL_SEC` | no | `git pull --ff-only` interval; 0 = disabled |
| `CODEBERG_GIT_DIR` | no | Git repo for pull (default `CODEBERG_ROOT`) |

## Agent tools (read-only)

Registered at `GET /tools`, invoked via `POST /tools/call`:

`grep`, `glob`, `read_file`, `list_dir`, `tree`, `head`, `tail`, `wc`, `sed`,
`pipe`, `git_log`, `git_blame`

All tools are sandboxed to `CODEBERG_ROOT`. `pipe` chains `rg`/`grep` with text
filters in one shell-free, allowlisted pipeline (e.g. `rg -l TODO | head -20`); see
[docs/http.md](docs/http.md#pipe--read-only-pipelines).

## Run

```sh
export CODEBERG_ROOT=/path/to/repo
export CBERG_MODEL=models/jina-embeddings-v2-base-code/model.onnx
export CBERG_INDEX_PATH=/tmp/codeberg.usearch
./core/build/bin/codeberg-d
curl 'http://localhost:8080/search?q=add+function&k=5'
```

## Layout

```
daemon/
├── cmd/codeberg-d/      HTTP + git pull + tool harness
├── internal/workspace/  sandboxed file/git primitives
├── internal/tools/      read-only agent tool registry
├── internal/indexctl/   Unix socket client to cberg-index
├── internal/supervisor/ spawns and restarts cberg-index
└── internal/httpserver/ JSON API
```

Core indexer: `core/cmd/cberg-index/`
