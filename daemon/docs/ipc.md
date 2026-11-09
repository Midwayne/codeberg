# cberg-index IPC

Unix domain socket protocol between `cberg-index` (C) and `codeberg-d` (Go).

Socket path: `CBERG_SOCKET` env (default `/tmp/codeberg-index.sock`).

Status probes use a separate `<CBERG_SOCKET>.health` listener and connection
queue, so embedding or a slow command cannot block health checks. This listener
accepts only `status`; the main socket continues accepting every command,
including `status`. The daemon falls back to the main socket when the health
socket is absent. That happens when `CBERG_SOCKET` is too long for the
`.health` suffix: the indexer logs a warning and serves status on the main
socket only. Keep the configured socket path short enough for the suffix to
fit the OS Unix socket path limit.

One `cberg-index` process serves one or more repository roots: `CODEBERG_ROOTS`
(`<key>\t<path>` records, newline-separated), supplied internally from a project.
Chunk ids restart at 1 per repo, so `(repo, id)` is
a result's identity.

## Framing

One request per connection, newline-terminated line in, one JSON line out.
A request line, including its newline, must fit in 8191 bytes. A longer line
is rejected with `code` `invalid_argument` and `error` `request too long`;
the indexer does not run a truncated command. The Go client applies the same
limit before it dials.

Replies are never clipped by a buffer size: every string is JSON-escaped in
full (control characters as `\u00XX`), and a reply that cannot be built
becomes `{"ok":false,"code":"out_of_memory","error":"out of memory"}`.

The indexer accepts one connection at a time. Each listener's backlog is 8.
The Go client queues at most 4 in-flight connections per socket so a full
backlog does not fail the dial. There is no connection pooling.

## Result limits

`cberg-index` owns every count default and maximum. A count field that is
missing, empty, zero, or negative selects the default; larger values are
clamped to the maximum. The Go client sends unset counts as empty fields.

| Command | Field | Default | Maximum |
|---------|-------|---------|---------|
| `search` | `k` | 10 | 64 |
| `symbol` | `limit` | 20 | 64 |
| `outline` | — | all chunks | 256 |
| `search_graph` | `limit` | 20 | 64 |
| `trace_path` | `limit` | 64 | 256 |
| `trace_path` | `max_depth` | 2 | — |
| `graph_hubs` | `limit` | 10 | 64 |
| `graph_refs` | `limit` | 50 | 256 |

List replies that carry `truncated` set it to `true` when the result count
reached the command's maximum, so more results may exist.

The Go client (`internal/indexctl`) opens a **new Unix socket connection per request**
(5 s dial timeout).

## Commands

### `status`

Request:

```
status
```

Response:

```json
{"ok":true,"ready":true,"indexing":false,"chunks":42,"version":"0.1.0","vectors_enabled":true,
 "repos":[{"key":"codeberg","ready":true,"chunks":42}]}
```

- `ready` — bootstrap finished and at least one repo is searchable; a repo that
  failed to bootstrap stays `ready:false` in `repos` without holding the whole
  daemon unhealthy.
- `vectors_enabled` — `CBERG_MODEL` and `CBERG_INDEX_PATH` are set.
- `progress` — optional `{repo, phase, completed, total}` snapshot. `phase` is `counting`, `graph`, `embedding`, or `finalizing`. Graph work counts files; embedding/finalizing counts chunks, including reused cached/duplicate chunks. `total:0` means the total is not known yet. Counts describe the active repository and stage.
- `indexing` — bootstrap or a watched update is building search and graph data.
  Commands return `ok:false` with `code` `not_ready` and `error` `index building; use grep, glob or read_file while indexing and graph creation finish` instead of waiting for build locks.
- Status reads published snapshots without taking the repo or embedder lock.
  Chunk counts update after chunk synchronization; readiness updates when a
  bootstrap or watched update completes. An in-flight update retains the last
  completed readiness while ordinary searches wait for the update's lock.

### `search`

Request (tab-separated fields):

```
search\t<query>[\t<k>[\t<repo>[\t<path_glob>[\t<kind>[\t<min_score>]]]]]
```

| Field | Required | Description |
|-------|----------|-------------|
| query | yes | Natural-language query (tabs replaced with spaces) |
| k | no | Max results |
| repo | no | Restrict to one repo key |
| path_glob | no | rg-style glob on chunk paths (`*.go` matches at any depth, `**` spans directories, `{a,b}`, `!` negation) |
| kind | no | Chunk kind filter (`function`, `method`, `class`, `struct`, `interface`, `window`, `section`, `key`). An unknown name is `invalid_argument`, not an unfiltered search. |
| min_score | no | Minimum similarity score (float) |

Without `repo`, search fans out across every ready repo — the query is embedded
once, each repo's index is searched, and hits merge by score. An unknown repo
key errors with `not found`.

Response:

```json
{"ok":true,"results":[{"id":1,"score":0.95,"repo":"codeberg","path":"src/main.go","symbol":"main","kind":"function","start_line":10,"end_line":25,"snippet":"..."}]}
```

### `chunk`

Fetch the full indexed chunk body.

Request:

```
chunk\t<repo>\t<id>
```

Response:

```json
{"ok":true,"chunk":{"id":1,"repo":"codeberg","path":"src/main.go","symbol":"main","kind":"function","start_line":10,"end_line":25,"snippet":"...","body":"...","truncated":false}}
```

### `symbol`

Case-insensitive symbol lookup in the chunk table (no vector search required).

Request:

```
symbol\t<name>[\t<repo>[\t<kind>[\t<limit>]]]
```

Response: same `results` array shape as `search`.

### `outline`

List indexed chunks in one file.

Request:

```
outline\t<repo>\t<path>
```

Response: same `results` array shape as `search` (one entry per chunk in the file).

### `search_graph`

Structural symbol search over the knowledge graph (exact name).

Request:

```
search_graph\t<name>[\t<repo>[\t<kind>[\t<path_prefix>[\t<limit>]]]]
```

| Field | Required | Description |
|-------|----------|-------------|
| name | yes | Exact node name |
| repo | no | Restrict starting definitions to one repo key (default: all configured roots) |
| kind | no | `file`, `function`, `method`, `class`, `struct`, `interface`, `module`, or `symbol` |
| path_prefix | no | Component-aware path prefix (`foo` matches `foo` / `foo/bar`, not `foobar`) |
| limit | no | Max results |

Response:

```json
{"ok":true,"results":[{"id":1,"repo":"codeberg","kind":"function","name":"helper","qname":"a.go::1::helper#0","path":"a.go","start_line":10,"end_line":12}],"truncated":false}
```

When the graph is disabled (`CBERG_GRAPH=0`) or unavailable:

```json
{"ok":false,"error":"graph disabled"}
```

### `trace_path`

BFS traversal from a named symbol.

Request:

```
trace_path\t<name>[\t<repo>[\t<direction>[\t<edge_kind>[\t<max_depth>[\t<limit>[\t<path_prefix>]]]]]]
```

| Field | Required | Description |
|-------|----------|-------------|
| name | yes | Start symbol name |
| repo | no | Repo key |
| direction | no | `in` (callers), `out` (callees), `both` (default) |
| edge_kind | no | `calls` (default), `imports`, `inherits`, `contains`, `defines`, `references`, `all` |
| max_depth | no | BFS depth |
| limit | no | Max hops |
| path_prefix | no | Component-aware prefix for start-symbol lookup |

Response:

```json
{"ok":true,"hops":[{"depth":1,"src":2,"dst":1,"kind":"calls","resolution":"textual","confidence":0.9,"line":8,"src_name":"Start","dst_name":"helper","src_path":"a.go","dst_path":"a.go"}],"truncated":false}
```

### `graph_stats`

Request:

```
graph_stats[\t<repo>]
```

Response:

```json
{"ok":true,"repo":"codeberg","nodes":1200,"refs":3400,"enabled":true,"languages":[{"lang":"go","files":80},{"lang":"typescript","files":12}]}
```

`languages` counts FILE nodes by path extension.

### `graph_hubs`

Degree hubs: symbols ranked by incident `CALLS` edges (in+out).

Request:

```
graph_hubs[\t<repo>[\t<limit>]]
```

Response:

```json
{"ok":true,"results":[{"id":1,"repo":"codeberg","kind":"function","name":"helper","qname":"a.go::1::helper#0","path":"a.go","start_line":10,"end_line":12,"degree":5}],"truncated":false}
```

### `graph_refs`

Incoming CALLS/INHERITS/IMPORTS/REFERENCES edges for a symbol (used by daemon `find_references`).
`REFERENCES` contains non-call symbol uses in Go, TypeScript, and JavaScript,
including callback and type-name references. `graph_refs` includes these edges
alongside calls, imports, and inheritance. Resolution remains syntactic and
partial; lexical scope, import aliases, and known receivers constrain candidates.

In a multi-root engine, graph search and references without `repo` inspect all
configured roots. `repo` scopes starting definitions; imports can carry a trace
or incoming caller across roots. Edges/hops include `src_repo` and `dst_repo`;
numeric IDs and relative paths remain native to those repositories. An unscoped
trace whose name matches definitions in multiple roots returns `invalid argument`;
provide `repo` to select its starting definition. `graph_stats` aggregates all
roots when repo is omitted (empty response `repo` denotes that aggregate).

The daemon's `find_references` tool asks for at most 200 edges; `truncated`
reports when the indexer's maximum was reached.

Request:

```
graph_refs\t<name>[\t<repo>[\t<limit>[\t<path_prefix>]]]
```

| Field | Required | Description |
|-------|----------|-------------|
| name | yes | Symbol name |
| repo | no | Repo key |
| limit | no | Max edges |
| path_prefix | no | Component-aware prefix to disambiguate same-named symbols |

Response: `{"ok":true,"results":[...edges...],"truncated":false}` with `resolution` and `confidence` on each edge.

## Errors

Every failure carries a machine `code` beside the English `error` text. The
daemon switches on `code`. Rewording `error` does not change the HTTP status.

```json
{"ok":false,"code":"not_found","error":"not found"}
```

| `code` | When | Daemon code |
|--------|------|-------------|
| `not_ready` | Index is building | `NOT_READY` |
| `not_implemented` | Feature unavailable, including `error` `graph disabled` | `NOT_IMPLEMENTED` |
| `not_found` | Missing repo, chunk, or symbol target | `NOT_FOUND` |
| `invalid_argument` | Missing field, unknown command, unknown chunk kind, health socket used for anything but `status`, request too long | `INVALID_ARGUMENT` |
| `internal_error` | Unexpected indexer failure | `INTERNAL_ERROR` |
| `io_error` | Filesystem failure | `IO_ERROR` |
| `out_of_memory` | Allocation failure | `OUT_OF_MEMORY` |
| `timeout` | Watcher poll timed out | `TIMEOUT` |
| `unsupported_language` | Language the library refuses | `UNSUPPORTED_LANGUAGE` |
| `corrupt` | Index snapshot unreadable or the wrong dimension | `CORRUPT` |

A reply with no `code`, or a `code` not in this table, is `INDEXER_ERROR`.
`UNSUPPORTED_LANGUAGE` and `CORRUPT` are specific daemon codes; HTTP still
responds 500 until the HTTP error table learns a dedicated status.

Socket names: the health listener is `<CBERG_SOCKET>.health` and the owner
lock is `<CBERG_SOCKET>.lock`. Both suffixes are part of this protocol.

## Notes

- Vector search (`search`) requires `CBERG_MODEL` + `CBERG_INDEX_PATH`.
- `chunk`, `symbol`, `outline`, and graph commands work in chunk-only mode
  (graph needs `CBERG_GRAPH` enabled, default on).
- Result counts follow [Result limits](#result-limits).
- Repos still bootstrapping are skipped in all-repo searches (partial results).

Go client: `daemon/internal/indexctl/` (`Client` implements the `Indexer` interface).
