# HTTP API (`codeberg-d`)

Minimal JSON over `net/http`. No auth in v0.1 — bind to localhost or place behind a reverse proxy.

## `GET /health`

```json
{ "status": "ok", "version": "v0.1.0" }
```

## `GET /search`

Query parameters:

| Param | Default | Description |
|-------|---------|-------------|
| `q` | — | Natural-language query (required) |
| `k` | 10 | Number of neighbors |

Response:

```json
{
  "results": [
    { "id": 42, "score": 0.91 }
  ]
}
```

Returns `503` when vector indexing is disabled or search fails.

## Errors

Plain-text body from `http.Error` for 4xx/5xx.
