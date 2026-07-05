# Module: `src/search/`

Approximate nearest-neighbor index (usearch HNSW) and high-level semantic search.

**Files:** `index.c`, `search.c`  
**Build flag:** `CBERG_WITH_USEARCH` (vendored `third_party/usearch`)  
**Depends on:** `embed/` for `cberg_search_query`

Index keys are **`uint64_t` chunk ids** from `cberg_chunk_table` — not chunk keys.

---

## `index.c`

### `cberg_index` (when usearch enabled)

```c
struct cberg_index {
    usearch_index_t idx;
    size_t dim;
    size_t expansion_search;  // cached default for restore after per-query override
    char *path;               // persistence path
};
```

Metric: **cosine** (`usearch_metric_cos_k`). Vectors: `float32`, single-threaded index
(`multi = false`).

`INITIAL_CAPACITY` = 1024 for first `usearch_reserve`.

### `file_exists(path)` — static

Probe fopen read mode for load vs create decision.

### `cberg_index_config_default` — public

Sets connectivity 16, expansion_add 128, expansion_search 64.

### `cberg_index_open` — public

1. Merge `config` with defaults.
2. `usearch_init` with HNSW options.
3. If `path` exists → `usearch_load`; else `usearch_reserve(1024)`.
4. Heap-alloc wrapper; copy path string.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_IO` (load fail),
`CBERG_ERR_INTERNAL`, `CBERG_ERR_OUT_OF_MEMORY`.

Without usearch: stubs return `CBERG_ERR_NOT_IMPLEMENTED`.

### `cberg_index_add` — public

**Replace semantics:**

1. If `usearch_contains(id)` → `usearch_remove(id)`.
2. If `size >= capacity` → double reserve.
3. `usearch_add(id, vector, f32)`.

Chunk re-embed on modify uses same id → old vector replaced.

### `cberg_index_remove` — public

`usearch_remove` if present; else `CBERG_ERR_NOT_FOUND`.

### `cberg_index_search` — public

1. Optionally `usearch_change_expansion_search` when `opts->expansion_search > 0`.
2. `usearch_search` → fills `out_ids` and distances in `out_scores`.
3. Restores previous expansion_search if changed.
4. Converts distance to **similarity**: `score = 1.0f - distance` (cosine).

`*out_found` ≤ `k`; may be less if index has fewer vectors.

### `cberg_index_save` — public

`usearch_save(idx, path)`.

### `cberg_index_close` — public

`usearch_free`, free path and struct.

---

## HNSW tuning

| Parameter | When applied | Effect |
|-----------|--------------|--------|
| `connectivity` | Index creation | Graph degree (quality vs memory) |
| `expansion_add` | Insert | efConstruction — recall of graph links |
| `expansion_search` | Query | efSearch — candidate list size during search |

`cberg_search_query` temporarily raises `expansion_search` for query embed path only.

---

## `search.c`

Orchestrates embed + search for natural-language queries.

### `cberg_search_config_default` — public

`oversample = 4`, `min_expansion_search = 64`.

### `cberg_search_query` — public

1. Validate pointers; `k == 0` → empty result.
2. `cberg_embedder_embed` on single query string (`query_len` may omit NUL terminator).
3. Compute `ef = max(min_expansion_search, k * oversample)`.
4. `cberg_index_search` with `cberg_index_search_opts { .expansion_search = ef }`.
5. `cberg_vectors_free` query vector.

Does not interpret ids — caller maps chunk ids back to stored chunks via
`cberg_chunk_table_find_by_id`.

### `cberg_search_vector` — public

Same as steps 3–4 above but takes a **precomputed** `query_vec` (`dim` floats).
Skips embed — used by multi-repo `cberg-index` to search several indexes after one
query embedding. `config` may be NULL for defaults.

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
cberg_index_save(index);  // optional persistence
```

Query path (single index):

```c
cberg_search_query(embedder, index, "how is auth handled?", len, NULL, 10, ids, scores, &found);
for (size_t i = 0; i < found; i++) {
    const cberg_stored_chunk *c = cberg_chunk_table_find_by_id(table, ids[i]);
    /* c->path, c->symbol, snippet from source */
}
```

Multi-index path (embed once, search many):

```c
float *vec;
cberg_embedder_embed(embedder, &query, &qlen, 1, &vec);
for each repo index:
    cberg_search_vector(index, vec, NULL, k, ids, scores, &found);
cberg_vectors_free(vec);
```

---

## Stub build (no usearch)

All `cberg_index_*` mutating/search functions return `CBERG_ERR_NOT_IMPLEMENTED`.
`cberg_index_config_default` still fills defaults. `cberg_search_query` fails at
`cberg_index_search` if index cannot be opened.
