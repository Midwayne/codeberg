# cberg-index IPC

Unix domain socket protocol between `cberg-index` (C) and `codeberg-d` (Go).

Socket path: `CBERG_SOCKET` env (default `/tmp/codeberg-index.sock`).

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
{"ok":true,"ready":true,"chunks":42,"version":"0.1.0"}
```

### `search`

Request (tab-separated):

```
search\t<query>\t<k>
```

Tabs in the query should be avoided; clients may replace them with spaces.

Response:

```json
{"ok":true,"results":[{"id":1,"score":0.95}]}
```

Error:

```json
{"ok":false,"error":"not found"}
```

## Notes

- Search requires vector indexing (`CBERG_MODEL` + `CBERG_INDEX_PATH`).
- `ready` is false until bootstrap completes.
- Results are capped at 64 per request in the C indexer.
