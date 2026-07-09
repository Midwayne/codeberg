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
| `CODEBERG_ROOT` | yes¹ | Repository tree to index: one path, or comma-separated list (only those dirs) |
| `CODEBERG_ROOTS` | yes¹ | `key\tpath` records, newline-separated — every repo to serve (supersedes `CODEBERG_ROOT` when set) |
| `CBERG_MODEL` | for vectors | Path to ONNX model |
| `CBERG_INDEX_PATH` | for vectors | Index **base path**; per-repo sidecars at `<base>.<roothash>[.chunks\|.manifest]` |
| `CBERG_INDEX_BACKEND` | no | `usearch` (default), `qdrant`, or `pgvector` (`postgres` alias) |
| `CBERG_INDEX_QUANT` | no | usearch stored scalar kind: `i8` (default) or `f32` (forwarded to `cberg-index`) |
| `CBERG_VECTORDB_URL` | for `qdrant` | Qdrant REST base URL |
| `CBERG_VECTORDB_API_KEY` | no | Qdrant API key (cloud) |
| `CBERG_POSTGRES_URL` | for `pgvector` | PostgreSQL connection string (pgvector extension) |
| `CBERG_POLL_MS` | no | Watcher poll timeout (default 1000) |
| `CBERG_SOCKET` | no | Unix socket for indexer IPC (default `/tmp/codeberg-index.sock`) |
| `CBERG_INDEX_BIN` | no | Path to `cberg-index` binary |
| `CODEBERG_HTTP_PORT` | no | HTTP listen port (default 8080) |
| `CODEBERG_GIT_PULL_INTERVAL_SEC` | no | `git pull --ff-only` interval; 0 = disabled |
| `CODEBERG_GIT_DIR` | no | Git repo(s) for pull (default: every served root with a `.git`) |

¹ Exactly one of `CODEBERG_ROOT` / `CODEBERG_ROOTS` is required.

Vector backend setup (Qdrant, pgvector, schemas, Docker):
[core/docs/VECTOR_INDEX_PROVIDERS.md](../core/docs/VECTOR_INDEX_PROVIDERS.md).

## Agent tools (read-only)

Registered at `GET /tools`, invoked via `POST /tools/call`. Full schemas and limits:
[docs/http.md](docs/http.md).

### Index and search

`search`, `get_chunk`, `find_symbol`, `file_outline`, `hybrid_search`, `search_graph`, `trace_path`, `detect_changes`, `get_architecture`, `find_references`

`find_symbol`, `file_outline`, and `get_chunk` work in **chunk-only mode** (no ONNX).
`search` and `hybrid_search` require `vectors_enabled`.

### Repo metadata

`repos` — lists served repositories (key + root). Other tools accept optional `repo`.

### File, tree, and transform

`grep`, `glob`, `read_file`, `list_dir`, `tree`, `head`, `tail`, `wc`, `sed`, `pipe`

### Git

`git_log`, `git_blame`

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

Multi-repo, run by hand (the launcher does this for you via `--all`/`--repos`,
or comma-separated `CODEBERG_ROOT` when pinning explicit paths). Paths must not
contain commas. `codeberg-d` expands a comma list into `CODEBERG_ROOTS` before
spawning `cberg-index` — the C binary itself does not split commas:

```sh
export CODEBERG_ROOT=/path/to/api,/path/to/frontend   # or CODEBERG_ROOTS below
export CBERG_MODEL=models/jina-embeddings-v2-base-code/model.onnx
export CBERG_INDEX_PATH=/tmp/codeberg.usearch
./core/build/bin/codeberg-d
curl 'http://localhost:8080/search?q=add+function&k=5'            # both repos, merged by score
curl 'http://localhost:8080/search?q=add+function&k=5&repo=api'   # just api
```

Keyed records (required when talking to `cberg-index` directly — same shape as
`~/.codeberg/repos`):

```sh
export CODEBERG_ROOTS=$'api\t/path/to/api\nfrontend\t/path/to/frontend'
export CBERG_MODEL=models/jina-embeddings-v2-base-code/model.onnx
export CBERG_INDEX_PATH=/tmp/codeberg.usearch
./core/build/bin/codeberg-d
```

## Layout

```
daemon/
├── cmd/codeberg-d/       HTTP + git pull + tool harness
├── docs/                 http.md, ipc.md, architecture.md
├── internal/
│   ├── bootstrap/        startup readiness polling
│   ├── config/           env parsing (roots, socket, git pull)
│   ├── domain/           Repo{Key, Root}
│   ├── git/              git subprocess helper
│   ├── gitpull/          periodic git pull
│   ├── httpserver/       JSON HTTP API
│   ├── indexctl/         Unix socket client to cberg-index
│   ├── search/           hybrid vector + lexical reranking
│   ├── subprocess/       safe pipe tool (allowlist, no shell)
│   ├── supervisor/       spawn and restart cberg-index
│   ├── tools/            read-only agent tool registry
│   └── workspace/        sandboxed, multi-repo file/git primitives
```

Core indexer: `core/cmd/cberg-index/` — [core/docs/CBERG_INDEX.md](../core/docs/CBERG_INDEX.md)
