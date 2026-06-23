# HTTP API (`codeberg-d`)

Pure Go daemon. Semantic search is proxied to the C `cberg-index` process over a Unix socket.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Daemon + indexer status (`ready`, `chunks`, `version`) |
| `GET` | `/search?q=…&k=10` | Vector search (requires `CBERG_MODEL` + `CBERG_INDEX_PATH`) |
| `GET` | `/tools` | List registered read-only agent tools |
| `POST` | `/tools/call` | Run a tool: `{"name":"grep","args":{…}}` |

## Tools

All tools are read-only and sandboxed to `CODEBERG_ROOT`:

`grep`, `glob`, `read_file`, `list_dir`, `tree`, `head`, `tail`, `wc`, `sed`, `git_log`, `git_blame`
