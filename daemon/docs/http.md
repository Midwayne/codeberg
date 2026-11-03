# HTTP API (`codeberg-d`)

Project-aware endpoints and compatibility behavior are described in [Projects](../../docs/projects.md#api).


Pure Go daemon. Semantic search and chunk-index operations are proxied to the
C `cberg-index` process over a Unix socket.

The daemon restores the project catalog; each active project serves one or more
repos through internal `CODEBERG_ROOTS` records. With no projects it stays idle.
Each repo has a stable key; search results and grep/glob hits
carry it, and tools accept it as `repo`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Daemon + indexer status |
| `GET` | `/resources` | Cached resource usage and history (loopback only) |
| `POST` | `/resources/clients` | Register a local web PID for monitoring |
| `POST` | `/resources/refresh` | Queue a background disk refresh |
| `GET` | `/search` | Vector search (see [Search](#search) below) |
| `GET` | `/tools` | List registered read-only agent tools |
| `POST` | `/tools/call` | Run a tool: `{"name":"grep","args":{…}}` |

With no embedding model configured, `/tools` omits `search` and `hybrid_search`;
calls to those tool names return HTTP `404 NOT_FOUND`. Exact-text, file, chunk, symbol,
and graph tools remain registered. `CODEBERG_VECTOR=false` explicitly disables
embeddings even if `CBERG_MODEL` is inherited. The launcher exposes this mode as
`codeberg --no-vector`.

`GET /projects` and successful project-deletion responses include a top-level
`vectorsEnabled` boolean for the configured launch mode. This response metadata
is available before any indexer starts and is not stored in `projects.json`.
The web proxy preserves it so the UI can hide routine indexing notices when
embeddings are disabled; actionable project errors remain visible.

### `GET /health`

```json
{
  "status": "ok",
  "pid": 1234,
  "ready": true,
  "indexing": false,
  "chunks": 12345,
  "version": "0.1.0",
  "vectors_enabled": true,
  "repos": [{"key": "codeberg", "ready": true, "chunks": 12345}]
}
```

- `ready` — bootstrap finished and at least one repo is searchable.
- `progress` — optional active repository/stage counts: `{ "repo": "codeberg", "phase": "embedding", "completed": 1500, "total": 2600 }`. Embedding/finalizing counts chunks; graph counts files. A zero total means the workload is still being determined.
- `indexing` — bootstrap or a watched update is building the index and graph. File tools remain available; index-only requests return `503 NOT_READY` promptly during that work.
- `pid` — daemon process ID, used to attribute resource usage for a local daemon.
  A remote daemon's PID must not be interpreted on the client's machine.
- `vectors_enabled` — `CBERG_MODEL` + `CBERG_INDEX_PATH` are configured; when
  `false`, vector search returns `501 NOT_IMPLEMENTED` but chunk-only tools
  (`find_symbol`, `file_outline`, `get_chunk`) still work.

### Resource monitoring

Resource monitoring details: [Web settings](../../docs/settings.md). Resource
requests read cached samples; CPU collection and disk scans run on independent
background loops. `after=<timestamp>` requests incremental history.

### Search

```
GET /search?q=<query>&k=10[&repo=<key>][&path_glob=<glob>][&kind=<kind>][&min_score=<0-1>]
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `q` | _(required)_ | Natural-language query |
| `k` | `10` | Max results |
| `repo` | all ready repos | Restrict to one repo key |
| `path_glob` | — | rg-style glob on chunk paths (e.g. `daemon/**`; `*.go` matches at any depth) |
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
| 500 | `INTERNAL` | Unexpected server or indexer failure |
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
      "schema": { "type": "object", "properties": { ... } }
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
| `hybrid_search` | Fused vector and independent lexical candidates with bounded top-hit context |
| `search_graph` | Locate a known exact, case-sensitive code symbol and choose its repo/path before tracing |
| `trace_path` | Follow source relationships; calls `in` = callers, `out` = callees; depth 1 = direct relationships |
| `detect_changes` | Git diff → hunk-overlapping symbols → 1–2 hop blast radius (direct / transitive); sets `fallback` when the requested range fails |
| `get_architecture` | Repo overview: size, FILE-node language mix, CALLS degree hubs, entrypoints |
| `find_references` | Graph usages plus additional word-boundary grep evidence; bounded and partial |

`hybrid_search` fetches up to `2×k` vector chunks and searches file contents
independently with bounded per-file matches. It fuses reciprocal ranks, merges
lexical lines inside vector chunks, favors files supported by both sources,
and diversifies the top `k` across files. The top three hits carry at most
6,000 characters of combined `context` with line ranges; `match_line` is the
best-ranked exact-text line in the hit, and truncated context stays centred on
it. The vector and lexical halves run concurrently. Lexical-only hits use
`id: 0`; use `read_file` for more context (not `get_chunk`). `repo` and
`path_glob` scope both branches; `kind` filters indexed lexical lines;
`min_score` filters the vector branch only. When vectors are unavailable,
lexical results can still be returned.

`find_references` returns `{source, graph?, matches?, partial, limit_reached,
graph_error?, lexical_error?}`. It queries graph and word-boundary `rg` evidence
even when the graph has hits. `source` is `graph`, `grep`, or `graph+grep`.
Lexical hits sharing a graph edge's source path and line are removed; graph
edges have priority within one combined `limit` (default 50, maximum 200).
`path_prefix` restricts graph target lookup; `path_glob` restricts lexical lookup.
`partial` is always true. `limit_reached` reports source saturation or dropped
combined evidence, not an exact count of omitted usages. A source failure is
reported alongside usable evidence; if neither source is usable, the tool fails.
Lexical matches may include declarations/comments. Graph edges include
`resolution` and heuristic `confidence`; neither source proves complete coverage.

For a caller question, locate the definition with `search_graph`, then call
`trace_path` with its exact `name`, `repo`, and relative file `path_prefix`,
`direction: "in"`, `edge_kind: "calls"`, and `max_depth: 1`. `repo`/`path_prefix`
filter the starting definition, not later hops. Defaults are both directions and
depth 2. Use a file node and `edge_kind: "imports"` for file dependencies; a
type and `"contains"` for members. Same-name methods can remain ambiguous even
within a file, so inspect source instead of treating confidence as a probability.
Use `find_references` for broader symbol usage and `find_symbol`/`get_chunk` for
indexed bodies. The graph describes parsed source, not verified runtime or
HTTP/RPC relationships. `detect_changes` labels graph proximity, while
`get_architecture` entrypoints are name-based candidates.

With several configured roots, omitted `repo` searches all of them. A supplied
`repo` scopes graph target lookup and lexical search; incoming graph callers may
still come from another root. Graph edges/hops include `src_repo`/`dst_repo` and
native per-repo IDs. Lexical deduplication uses `(repo,path,line)`. IPC truncation
is retained as a graph coverage error and sets `limit_reached`, even when fewer
than the requested number of edges fit in the wire response.

`find_symbol`, `file_outline`, `get_chunk`, `search_graph`, and `trace_path` work in
**chunk-only mode** (without ONNX / vector indexing). Without an embedding model,
`search` and `hybrid_search` are omitted from the tool registry. In embedding-enabled
mode, `hybrid_search` can use its lexical branch while vectors are unavailable
during indexing. Graph tools return `501` / `graph disabled` when `CBERG_GRAPH=0`.

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

Structural tools are an exception: `search_graph`, `find_references`, hubs, and
architecture inspect all configured roots when `repo` is omitted. `trace_path`
can follow import-backed links across roots, but an ambiguous starting name
spanning several repos requires `repo`. Separately selected browser projects
remain isolated; only roots configured together share this query view.

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
other advertised daemon tools are available to the model automatically. When the
daemon omits `search`, the agent omits `search_code` and `search_bundle` and uses
lexical search guidance. No readiness wait is needed to choose the tool list.

See [agent/README.md](../../agent/README.md) for the recommended search workflow.
