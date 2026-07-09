# HTTP API (`codeberg-d`)

Pure Go daemon. Semantic search and chunk-index operations are proxied to the
C `cberg-index` process over a Unix socket.

The daemon serves one or more repos (`CODEBERG_ROOTS` records, or the single
`CODEBERG_ROOT`). Each repo has a stable key; search results and grep/glob hits
carry it, and tools accept it as `repo`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Daemon + indexer status |
| `GET` | `/search` | Vector search (see [Search](#search) below) |
| `GET` | `/tools` | List registered read-only agent tools |
| `POST` | `/tools/call` | Run a tool: `{"name":"grep","args":{…}}` |

### `GET /health`

```json
{
  "status": "ok",
  "ready": true,
  "chunks": 12345,
  "version": "0.1.0",
  "vectors_enabled": true,
  "repos": [{"key": "codeberg", "ready": true, "chunks": 12345}]
}
```

- `ready` — bootstrap finished and at least one repo is searchable.
- `vectors_enabled` — `CBERG_MODEL` + `CBERG_INDEX_PATH` are configured; when
  `false`, vector search returns `501 NOT_IMPLEMENTED` but chunk-only tools
  (`find_symbol`, `file_outline`, `get_chunk`) still work.

### Search

```
GET /search?q=<query>&k=10[&repo=<key>][&path_glob=<glob>][&kind=<kind>][&min_score=<0-1>]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `q` | _(required)_ | Natural-language query |
| `k` | `10` | Max results |
| `repo` | all ready repos | Restrict to one repo key |
| `path_glob` | — | fnmatch glob on chunk paths (e.g. `daemon/*`) |
| `kind` | — | Chunk kind: `function`, `method`, `class`, `struct`, `interface`, `window`, `section`, `key` |
| `min_score` | — | Minimum similarity score (0–1) |

Response:

```json
{"results": [{"id": 1, "score": 0.9, "repo": "codeberg", "path": "src/main.go", "symbol": "main", "start_line": 10, "end_line": 25, "snippet": "..."}]}
```

### Errors

Failed requests return structured JSON:

```json
{"ok": false, "code": "NOT_FOUND", "message": "indexer: not found (NOT_FOUND)"}
```

| HTTP | Code | Typical cause |
|------|------|---------------|
| 400 | `MISSING_QUERY` | `/search` without `q` |
| 400 | `INVALID_K` | `/search` with bad `k` |
| 400 | `INVALID_ARGS` | Tool args failed JSON schema or validation |
| 400 | `UNSAFE_PIPE` / `UNSAFE_SED` | Disallowed pipeline or sed script |
| 403 | `FORBIDDEN` | Path escapes repo sandbox |
| 404 | `NOT_FOUND` | Unknown tool, missing chunk/id, indexer not found |
| 501 | `NOT_IMPLEMENTED` | Vector search when `vectors_enabled` is false |
| 500 | `INTERNAL_ERROR` | Unexpected server or indexer failure |
| 500 | `IO_ERROR` | Filesystem or indexer I/O |
| 504 | `TIMEOUT` | Subprocess or indexer timeout |

Successful tool calls return HTTP 200 with `{"result": …}` even when a subprocess
stage exits nonzero (e.g. `rg` finding nothing) — check `exit_codes` in pipe results.

### `GET /tools`

Lists registered tools with JSON Schema metadata:

```json
{
  "tools": [
    {
      "name": "grep",
      "description": "Search file contents with ripgrep",
      "inputSchema": { "type": "object", "properties": { ... } }
    }
  ]
}
```

### `POST /tools/call`

Request:

```json
{"name": "grep", "args": {"pattern": "chunking", "literal": true, "limit": 5}}
```

Success:

```json
{"result": { ... }}
```

Error (same envelope as other endpoints):

```json
{"ok": false, "code": "INVALID_ARGS", "message": "..."}
```

## Tools

All tools are read-only and sandboxed to their repo's root.

### Index and search tools

| Tool | Purpose |
|------|---------|
| `search` | Semantic vector search (same as `GET /search`) |
| `get_chunk` | Full indexed chunk body for a `(repo, id)` hit |
| `find_symbol` | Case-insensitive symbol lookup in the chunk table |
| `file_outline` | Indexed chunks in a file with line ranges |
| `hybrid_search` | Vector search reranked by query-term presence in hit chunks |
| `search_graph` | Exact-name structural search over the knowledge graph |
| `trace_path` | BFS over call/import/inherit edges (returns resolution + confidence) |
| `find_references` | Graph-first symbol usages; word-boundary grep fallback |

`hybrid_search` accepts the same filters as `search` (`repo`, `path_glob`, `kind`,
`min_score`). It fetches `2×k` vector candidates, scores query terms against chunk
snippet/symbol text (falling back to the full file when needed), adds **+0.05** per
matching term, sorts by `final_score`, and truncates to `k`.

`find_references` prefers knowledge-graph edges (`source: "graph"`) and falls back
to a word-boundary `rg` (`source: "grep"`). Graph edges include `resolution` and
`confidence` so agents can distrust textual links.

`find_symbol`, `file_outline`, `get_chunk`, `search_graph`, and `trace_path` work in
**chunk-only mode** (without ONNX / vector indexing). `search` and `hybrid_search`
require `vectors_enabled`. Graph tools return `501` / `graph disabled` when
`CBERG_GRAPH=0`.

### File and repo tools

| Tool | Purpose |
|------|---------|
| `repos` | List served repositories (key + root) |
| `grep` | Regex or literal search over files |
| `glob` | Find files by pattern |
| `read_file` | Read file content or a line range |
| `list_dir` | List one directory |
| `tree` | Directory tree (skips `.git`, `node_modules`, `vendor`, etc.) |
| `head` / `tail` / `wc` | Quick file inspection |
| `sed` | Read-only sed script via stdin |
| `pipe` | Read-only pipeline (see below) |
| `git_log` / `git_blame` | Git history and per-line authorship |

`repos` lists the served repositories. Other tools take an optional `repo` key:
with a single served repo it defaults to that repo; in multi-repo (`--all`) mode
the key is required and an invalid value returns the available keys in the error.

### `pipe` — read-only pipelines

Runs a chained pipeline over the repo in one call:

```json
{"name":"pipe","args":{"command":"rg -l 'func main' --glob '*.go' | head -20"}}
```

Returns `{"command", "stdout", "truncated", "exit_codes"}`. **No shell is invoked** —
the command is tokenized (quote-aware), split on `|`, and each stage is exec'd
directly with `Dir` set to the repo root. Therefore:

- **Allowed commands:** `rg`, `grep`, `head`, `tail`, `wc`, `sort`, `uniq`, `cut`,
  `tr`, `nl`, `cat`, `paste`, `sed` (read-only script, as the `sed` tool). `awk` and
  `xargs` are excluded (they can execute arbitrary commands).
- **Rejected (400):** redirection/substitution/sequencing (`>`, `<`, `;`, `&`, `$()`,
  backticks), write/exec flags (`rg --pre`, `sort -o`, `sed -i`), and any command not
  on the allowlist.
- **Rejected (403):** absolute paths or `..` traversal in any argument.
- Output is capped (`truncated` flag); the run has a timeout; a stage exiting nonzero
  (e.g. `rg` finding nothing) is reported in `exit_codes`, not an error.

### Workspace limits

| Tool / area | Limit |
|-------------|-------|
| `grep` | 200 matches (default) |
| `glob` | 500 files |
| `read_file` | 64 KiB returned content; 4 MiB raw read cap |
| `git_log` | 20–200 entries |
| `git_blame` | 128 KiB output |
| `sed` | 64 KiB output |
| `tree` | depth 3, 2000 entries; skips `.git`, `node_modules`, etc. |
| `pipe` | 256 KiB stdout, 15 s timeout |

## Agent integration

The TypeScript agent bridges daemon tools via `daemonToolSource`, but **hides**
the daemon `search` tool because the built-in `search_code` tool already wraps
`GET /search` with a compact result shape and evidence-ledger capture. All
other daemon tools (including `get_chunk`, `hybrid_search`, etc.) are available
to the model automatically.

See [agent/README.md](../../agent/README.md) for the recommended search workflow.
