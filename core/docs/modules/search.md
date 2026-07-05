# Module: `src/search/`

Approximate nearest-neighbor vector index and high-level semantic search.

**Files:** `index.c`, `search.c`, `providers/`  
**Build flags:** `CBERG_WITH_USEARCH` (vendored usearch), optional `CBERG_WITH_CURL`
(Qdrant HTTPS), `CBERG_WITH_PGVECTOR` (libpq)  
**Depends on:** `embed/` for `cberg_search_query`

Index keys are **`uint64_t` chunk ids** from `cberg_chunk_table` — not chunk keys.

**Operator docs:** [VECTOR_INDEX_PROVIDERS.md](../VECTOR_INDEX_PROVIDERS.md) —
backend choice, env vars, remote schemas, server setup.

---

## Architecture

```
index.c              public cberg_index_* facade
providers/
  registry.c         dispatch by CBERG_INDEX_BACKEND name
  common.c           codeberg_<16hex> collection/table naming
  usearch/usearch.c  local HNSW file
  qdrant/            REST client (http_client.c + qdrant.c)
  pgvector/          libpq SQL backend
search.c             embed + search orchestration
```

`cberg_index_open` selects a backend from `cberg_index_config.provider` (or env
via `cberg_index_provider_from_name`). Chunk sidecars always use the local
`<index_path>`; remote backends store vectors at `vectordb_url` or
`postgres_url`.

---

## `index.c`

Thin wrapper around `cberg_index_backend` vtable (`providers/provider.h`).

### `cberg_index_open` — public

1. Merge `config` with defaults (`cberg_index_config_default`).
2. `cberg_index_provider_open` → backend-specific open.
3. Heap-alloc `cberg_index` wrapper.

**usearch:** loads or creates file at `path`.  
**qdrant / pgvector:** `path` identifies collection/table name; connection URL in config.

### `cberg_index_add` / `remove` / `search` / `save`

Delegate to backend. All backends use **cosine** distance; search scores are
`1.0 - distance` (similarity, best-first).

**Replace semantics on add:** if id exists, remove then insert (chunk re-embed).

### `cberg_index_clear` — public

Drop all vectors in place (rebuild helper). usearch clears graph; Qdrant
recreates collection; pgvector `TRUNCATE`s table.

### `cberg_index_wipe` — public

Remove all vectors for `path` without an open handle. Used during corrupt-index
recovery in `cberg-index`.

### `cberg_index_close` — public

Backend destroy + free wrapper.

---

## usearch backend (`providers/usearch/usearch.c`)

```c
struct cberg_index {
    usearch_index_t idx;
    size_t dim;
    size_t expansion_search;
    char *path;
};
```

Metric: **cosine** (`usearch_metric_cos_k`). Vectors: `float32`, single-threaded.

| Parameter | Default | Effect |
|-----------|---------|--------|
| `connectivity` | 16 | HNSW graph degree |
| `expansion_add` | 128 | efConstruction |
| `expansion_search` | 64 | efSearch baseline |

`cberg_index_search` can override `expansion_search` per query via
`cberg_index_search_opts`.

---

## Qdrant backend (`providers/qdrant/`)

REST API to Qdrant. Collection per repo: `codeberg_<16hex>` from hash of
`path`. Creates collection on first open (cosine, model dimension).

- **save:** no-op (vectors persisted on upsert)
- **clear:** delete + recreate collection
- **wipe:** delete collection

Requires `config->vectordb_url`. Optional `vectordb_api_key` for cloud.
`https://` needs libcurl at build time.

---

## pgvector backend (`providers/pgvector/pgvector.c`)

libpq SQL backend. Table per repo: `codeberg_<16hex>`. Auto-creates extension
and table on open.

```sql
CREATE TABLE codeberg_<16hex> (
  id BIGINT PRIMARY KEY,
  embedding vector(<dim>)
);
```

Search: `ORDER BY embedding <=> query LIMIT k`. No HNSW index created by
Codeberg (sequential scan).

Requires `config->postgres_url` and `CBERG_WITH_PGVECTOR` build.

---

## `search.c`

Orchestrates embed + search for natural-language queries.

### `cberg_search_query` — public

1. `cberg_embedder_embed` on query string.
2. Compute `ef = max(min_expansion_search, k * oversample)`.
3. `cberg_index_search` with expansion override (usearch only).
4. Free query vector.

### `cberg_search_vector` — public

Same as step 3 but takes a precomputed query vector — used by multi-repo
`cberg-index` IPC (embed once, search each repo).

---

## Indexing loop integration

After `cberg_chunk_table_sync`:

```c
for (i = 0; i < changes.added_len; i++)
    embed body → cberg_index_add(index, changes.added[i].id, vec);
for (i = 0; i < changes.modified_len; i++)
    embed body → cberg_index_add(index, changes.modified[i].id, vec);
for (i = 0; i < changes.deleted_len; i++)
    cberg_index_remove(index, changes.deleted[i].id);
cberg_index_save(index);  // usearch only; no-op for remote backends
```

---

## Stub builds

Without usearch: local index stubs return `CBERG_ERR_NOT_IMPLEMENTED`.  
Without libcurl: Qdrant `https://` returns `NOT_IMPLEMENTED`.  
Without libpq: pgvector returns `NOT_IMPLEMENTED`.
