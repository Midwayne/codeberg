# cberg-index IPC

Unix domain socket protocol between `cberg-index` (C) and `codeberg-d` (Go).

Socket path: `CBERG_SOCKET` env (default `/tmp/codeberg-index.sock`).

One `cberg-index` process serves one or more repository roots: `CODEBERG_ROOTS`
(`<key>\t<path>` records, newline-separated) or the single-root `CODEBERG_ROOT`
fallback (key = basename). Chunk ids restart at 1 per repo, so `(repo, id)` is
a result's identity.

## Framing

One request per connection, newline-terminated line in, one JSON line out.

## Commands

### `status`

Request:

```
status
```

Response:

```json
{"ok":true,"ready":true,"chunks":42,"version":"0.1.0",
 "repos":[{"key":"codeberg","ready":true,"chunks":42}]}
```

`ready` is true once the bootstrap pass finished and at least one repo is
searchable; a repo that failed to bootstrap stays `ready:false` in `repos`
without holding the whole daemon unhealthy.

### `search`

Request (tab-separated; the repo field is optional):

```
search\t<query>\t<k>[\t<repo>]
```

Tabs in the query should be avoided; clients may replace them with spaces.
Without a repo the search fans out across every ready repo — the query is
embedded once, each repo's index is searched, and hits merge by score. An
unknown repo key errors with `not found`.

Response:

```json
{"ok":true,"results":[{"id":1,"score":0.95,"repo":"codeberg","path":"src/main.go","symbol":"main","start_line":10,"end_line":25,"snippet":"..."}]}
```

Error:

```json
{"ok":false,"error":"not found"}
```

## Notes

- Search requires vector indexing (`CBERG_MODEL` + `CBERG_INDEX_PATH`).
- Results are capped at 64 per request in the C indexer.
- Repos still bootstrapping are skipped in all-repo searches (partial results).
