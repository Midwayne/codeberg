# cberg-index IPC

Unix domain socket protocol between `cberg-index` (C) and `codeberg-d` (Go).

Socket path: `CBERG_SOCKET` env (default `/tmp/codeberg-index.sock`).

One `cberg-index` process serves one or more repository roots: `CODEBERG_ROOTS`
(`<key>\t<path>` records, newline-separated) or the single-root `CODEBERG_ROOT`
fallback (key = basename). Chunk ids restart at 1 per repo, so `(repo, id)` is
a result's identity.

## Framing

One request per connection, newline-terminated line in, one JSON line out.

The Go client (`internal/indexctl`) opens a **new Unix socket connection per request**
(5 s dial timeout). There is no connection pooling.

## Commands

### `status`

Request:

```
status
```

Response:

```json
{"ok":true,"ready":true,"chunks":42,"version":"0.1.0","vectors_enabled":true,
 "repos":[{"key":"codeberg","ready":true,"chunks":42}]}
```

- `ready` — bootstrap finished and at least one repo is searchable; a repo that
  failed to bootstrap stays `ready:false` in `repos` without holding the whole
  daemon unhealthy.
- `vectors_enabled` — `CBERG_MODEL` and `CBERG_INDEX_PATH` are set.

### `search`

Request (tab-separated fields):

```
search\t<query>\t<k>[\t<repo>[\t<path_glob>[\t<kind>[\t<min_score>]]]]
```

| Field | Required | Description |
|-------|----------|-------------|
| query | yes | Natural-language query (tabs replaced with spaces) |
| k | no | Max results (default 10) |
| repo | no | Restrict to one repo key |
| path_glob | no | fnmatch glob on chunk paths |
| kind | no | Chunk kind filter (`function`, `method`, `class`, `struct`, `interface`, `window`, `section`, `key`) |
| min_score | no | Minimum similarity score (float) |

Without `repo`, search fans out across every ready repo — the query is embedded
once, each repo's index is searched, and hits merge by score. An unknown repo
key errors with `not found`.

Response:

```json
{"ok":true,"results":[{"id":1,"score":0.95,"repo":"codeberg","path":"src/main.go","symbol":"main","start_line":10,"end_line":25,"snippet":"..."}]}
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
| repo | no | Restrict to one repo key (default: first ready repo with a graph) |
| kind | no | `file`, `function`, `method`, `class`, `struct`, `interface`, `module`, or `symbol` |
| path_prefix | no | Component-aware path prefix (`foo` matches `foo` / `foo/bar`, not `foobar`) |
| limit | no | Max results (default 20; IPC stack cap 64) |

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
| max_depth | no | BFS depth (default 2) |
| limit | no | Max hops (default 64; IPC stack cap 256) |
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

Incoming CALLS/INHERITS/IMPORTS edges for a symbol (used by daemon `find_references`).
`REFERENCES` is reserved and not extracted yet.

Request:

```
graph_refs\t<name>[\t<repo>[\t<limit>[\t<path_prefix>]]]
```

| Field | Required | Description |
|-------|----------|-------------|
| name | yes | Symbol name |
| repo | no | Repo key |
| limit | no | Max edges (default 50; IPC stack cap 64) |
| path_prefix | no | Component-aware prefix to disambiguate same-named symbols |

Response: `{"ok":true,"results":[...edges...],"truncated":false}` with `resolution` and `confidence` on each edge.

## Errors

```json
{"ok":false,"error":"not found"}
```

Common error strings map to daemon HTTP codes: `not implemented`, `graph disabled`,
`not found`, `invalid argument`, `internal error`, `i/o error`, `out of memory`,
`timeout`.

## Notes

- Vector search (`search`) requires `CBERG_MODEL` + `CBERG_INDEX_PATH`.
- `chunk`, `symbol`, `outline`, and graph commands work in chunk-only mode
  (graph needs `CBERG_GRAPH` enabled, default on).
- Results are capped at 64 per request in the C indexer (trace hops up to 256);
  responses include `"truncated":true` when the stack/response cap clipped results.
- Repos still bootstrapping are skipped in all-repo searches (partial results).

Go client: `daemon/internal/indexctl/` (`Client` implements the `Indexer` interface).
