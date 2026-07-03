# Codeberg daemon (Go)

Go orchestration layer: supervises the C **`cberg-index`** indexer, serves HTTP
(`/health`, `/search`, agent tools), and optional scheduled `git pull`.

Indexing runs entirely in **`cberg-index`** (C, links `libcodeberg`). The Go
daemon has no CGO — it talks to the indexer over a Unix socket.

**Multi-repo:** both the daemon and `cberg-index` can serve one root or many
from a single process, sharing one embedding model. See
[docs/multi-repo.md](../docs/multi-repo.md) and
[ADR 0004](../core/docs/adr/0004-multi-root-engine.md) for the design, and
[docs/ipc.md](docs/ipc.md) / [docs/http.md](docs/http.md) for the wire
protocols this section summarizes.

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
| `CODEBERG_ROOT` | yes¹ | Repository tree to index (single-repo mode) |
| `CODEBERG_ROOTS` | yes¹ | `key\tpath` records, newline-separated — every repo to serve (multi-repo mode; supersedes `CODEBERG_ROOT` when set) |
| `CBERG_MODEL` | for vectors | Path to ONNX model |
| `CBERG_INDEX_PATH` | for vectors | usearch index **base path**; the actual index and its chunk-table/manifest sidecars are per-repo (`<base>.<roothash>[.chunks\|.manifest]`) |
| `CBERG_POLL_MS` | no | Watcher poll timeout (default 1000) |
| `CBERG_SOCKET` | no | Unix socket for indexer IPC (default `/tmp/codeberg-index.sock`) |
| `CBERG_INDEX_BIN` | no | Path to `cberg-index` binary |
| `CODEBERG_HTTP_PORT` | no | HTTP listen port (default 8080) |
| `CODEBERG_GIT_PULL_INTERVAL_SEC` | no | `git pull --ff-only` interval; 0 = disabled |
| `CODEBERG_GIT_DIR` | no | Git repo(s) for pull (default: every served root with a `.git`) |

¹ Exactly one of `CODEBERG_ROOT` / `CODEBERG_ROOTS` is required.

## Agent tools (read-only)

Registered at `GET /tools`, invoked via `POST /tools/call`:

`repos`, `grep`, `glob`, `read_file`, `list_dir`, `tree`, `head`, `tail`, `wc`,
`sed`, `pipe`, `git_log`, `git_blame`

`repos` lists the served repositories (key + root) — the values every other
tool's optional `repo` argument accepts. With a single served repo, `repo` may
be omitted and defaults to it; with several, it's required (an unhelpful value
returns the available keys in the error). Every tool is sandboxed to its
resolved repo's root — never the process's other repos. `pipe` chains
`rg`/`grep` with text filters in one shell-free, allowlisted pipeline (e.g.
`rg -l TODO | head -20`); see
[docs/http.md](docs/http.md#pipe--read-only-pipelines).

## Run

```sh
export CODEBERG_ROOT=/path/to/repo
export CBERG_MODEL=models/jina-embeddings-v2-base-code/model.onnx
export CBERG_INDEX_PATH=/tmp/codeberg.usearch
./core/build/bin/codeberg-d
curl 'http://localhost:8080/search?q=add+function&k=5'
```

Multi-repo, run by hand (the launcher does this for you via `--all`/`--repos`):

```sh
export CODEBERG_ROOTS=$'api\t/path/to/api\nfrontend\t/path/to/frontend'
export CBERG_MODEL=models/jina-embeddings-v2-base-code/model.onnx
export CBERG_INDEX_PATH=/tmp/codeberg.usearch
./core/build/bin/codeberg-d
curl 'http://localhost:8080/search?q=add+function&k=5'            # both repos, merged by score
curl 'http://localhost:8080/search?q=add+function&k=5&repo=api'   # just api
```

## Layout

```
daemon/
├── cmd/codeberg-d/      HTTP + git pull + tool harness
├── internal/workspace/  sandboxed, multi-repo file/git primitives
├── internal/tools/      read-only agent tool registry (incl. `repos`)
├── internal/indexctl/   Unix socket client to cberg-index
├── internal/supervisor/ spawns and restarts cberg-index
├── internal/gitpull/    periodic `git pull` across every served root
└── internal/httpserver/ JSON API
```

Core indexer: `core/cmd/cberg-index/`
