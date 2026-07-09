# Public API reference

Every symbol exported from `include/codeberg/codeberg.h`. Internal helpers live in
`src/` and are documented in [modules/](modules/).

**Conventions**

- Fallible functions return `cberg_status`. Out-parameters are valid only on `CBERG_OK`.
- Opaque handles (`cberg_chunker`, `cberg_chunk_table`, `cberg_watcher`, `cberg_embedder`, `cberg_index`) are released by the matching `*_close` / `*_free` (all NULL-safe).
- String ownership is documented per function; when in doubt, treat returned strings as borrowed unless the function name ends in `_free` or the docs say the caller must `free`.

---

## Status and version

### `cberg_status`

| Value | Meaning |
|-------|---------|
| `CBERG_OK` | Success |
| `CBERG_ERR_INVALID_ARGUMENT` | NULL pointer, empty required field, out-of-range span, etc. |
| `CBERG_ERR_INTERNAL` | Tree-sitter failure, usearch/ONNX internal error, unexpected state |
| `CBERG_ERR_IO` | File open/load/save, inotify/FSEvents setup failure |
| `CBERG_ERR_UNSUPPORTED_LANGUAGE` | Reserved; chunker uses window fallback instead of failing |
| `CBERG_ERR_NOT_FOUND` | Index remove when id absent; `*_load` when snapshot missing or incompatible version; `cberg_config_resolve_index_root` when `CODEBERG_ROOT` unset or path missing |
| `CBERG_ERR_OUT_OF_MEMORY` | `malloc` / arena allocation failed |
| `CBERG_ERR_TIMEOUT` | `cberg_watcher_poll` blocked and timed out (Linux inotify path) |
| `CBERG_ERR_NOT_IMPLEMENTED` | Feature compiled out (no ONNX / no usearch) |
| `CBERG_ERR_CORRUPT` | Vector index snapshot unreadable or dimension mismatch — safe to wipe and rebuild |

### `cberg_status_str(cberg_status status)`

Returns a short English phrase for `status`. Unknown codes return `"unknown error"`. The pointer is static/read-only; do not free.

### `cberg_version(void)`

Returns the library version string (from repo `VERSION`, e.g. `"v0.0.1"`). Static storage.

---

## Configuration

### `CBERG_INDEX_ROOT_ENV`

Macro: `"CODEBERG_ROOT"` — environment variable naming the codebase tree to index.

### `cberg_config_index_root_env_name(void)`

Returns `"CODEBERG_ROOT"`.

### `cberg_config_index_root(void)`

Reads `CODEBERG_ROOT` from the environment. Returns NULL if unset or empty. Pointer is process-lifetime; do not free.

### `cberg_config_resolve_index_root(char *out, size_t out_cap)`

Writes `realpath(CODEBERG_ROOT)` into `out`. Symlink roots are allowed. **Returns:** `CBERG_OK`, `CBERG_ERR_NOT_FOUND`, `CBERG_ERR_IO`, `CBERG_ERR_INVALID_ARGUMENT`.

---

## Hashing

### `CBERG_HASH_LEN`

`32` — size of `content_hash` arrays and fingerprint output. XXH3-128 produces 16 bytes; the implementation zero-pads the upper 16 bytes.

### `cberg_hash(const void *data, size_t len, uint8_t out[CBERG_HASH_LEN])`

Computes a **per-chunk content digest**: XXH3-128 over `len` bytes at `data`, written to `out` (zero-padded to 32 bytes).

- `data` may be NULL only when `len == 0`.
- Used by `cberg_chunk_list_hash_bodies` and available for standalone hashing.
- **Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`.

### `cberg_fingerprint(const char *const *keys, const uint8_t *const *hashes, size_t count, uint8_t out[CBERG_HASH_LEN])`

Computes an **order-independent set fingerprint** over `(key, content_hash)` pairs:

1. Sort pairs by `key` (lexicographic).
2. Stream each `key || 0x00 || content_hash` (32 bytes) into XXH3-128.
3. Write digest to `out` (zero-padded).

- `count == 0` → all-zero `out`, `CBERG_OK`.
- Each `keys[i]` must be non-NULL when `count > 0`.
- **Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_OUT_OF_MEMORY`.

---

## Languages and chunking

### `cberg_language`

| Enum | Extension(s) |
|------|----------------|
| `CBERG_LANG_UNKNOWN` | — (window fallback) |
| `CBERG_LANG_GO` | `.go` |
| `CBERG_LANG_TYPESCRIPT` | `.ts`, `.tsx` |
| `CBERG_LANG_JAVASCRIPT` | `.js`, `.jsx`, `.mjs`, `.cjs` |
| `CBERG_LANG_C` | `.c`, `.h` |
| `CBERG_LANG_KOTLIN` | `.kt`, `.kts` |
| `CBERG_LANG_PYTHON` | `.py`, `.pyi` |
| `CBERG_LANG_JAVA` | `.java` |
| `CBERG_LANG_MARKDOWN` | `.md`, `.markdown` |

### `cberg_language_from_path(const char *path)`

Maps file extension to language. `NULL` path → `CBERG_LANG_UNKNOWN`.

### `cberg_chunk_kind`

`UNKNOWN`, `FUNCTION`, `METHOD`, `CLASS`, `STRUCT`, `INTERFACE`, `WINDOW` (50-line fallback windows),
`SECTION` (markdown heading sections; symbol is a breadcrumb like `Install > Usage`).

### `cberg_span`

Byte and line range in the source buffer: `start_byte`, `end_byte`, `start_line`, `end_line` (1-based lines).

### `cberg_chunk`

| Field | Description |
|-------|-------------|
| `key` | Stable id: `"<path>::<kind>::<symbol>#<n>"` |
| `path` | Repo-relative or caller path string |
| `symbol` | Name node text, breadcrumb for markdown sections, or NULL for windows |
| `kind` | Chunk kind enum |
| `span` | Location in source |
| `content_hash` | Filled by `cberg_chunk_list_hash_bodies` |

### `cberg_chunker_open(cberg_chunker **out_chunker)`

Allocates a chunker with empty parser/query slots. **Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_OUT_OF_MEMORY`.

### `cberg_chunker_close(cberg_chunker *chunker)`

Deletes all cached tree-sitter parsers and queries; frees the chunker. NULL-safe.

### `cberg_chunker_parse(cberg_chunker *chunker, cberg_language lang, const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list)`

Parses `src` into chunks:

- `CBERG_LANG_MARKDOWN` → heading-aware sections (`CBERG_CHUNK_SECTION`).
- Known language → tree-sitter query captures (functions, methods, types).
- `CBERG_LANG_UNKNOWN` → 50-line sliding windows (`CBERG_CHUNK_WINDOW`).

Keys, paths, and symbols in the list are arena-owned. Caller frees with `cberg_chunk_list_free`.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_OUT_OF_MEMORY`, `CBERG_ERR_INTERNAL`.

### `cberg_chunk_list_len(const cberg_chunk_list *list)`

Number of chunks. `NULL` list → `0`.

### `cberg_chunk_list_at(const cberg_chunk_list *list, size_t index)`

Pointer to chunk at `index`, or NULL if out of range.

### `cberg_chunk_list_free(cberg_chunk_list *list)`

Frees arena, chunk array, and list struct. NULL-safe.

### `cberg_chunk_list_hash_bodies(const cberg_chunk_list *list, const char *src, size_t src_len)`

For each chunk, hashes `src[span.start_byte:span.end_byte]` into `content_hash` via `cberg_hash`. Validates spans against `src_len`.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`.

---

## Chunk table (change tracking)

### `cberg_stored_chunk`

`uint64_t id` + `cberg_chunk` — id assigned at first insert, stable across content edits.

### `cberg_changes`

Pointers to arrays owned by the table until the next `sync` or `free`:

- `added` / `added_len`
- `modified` / `modified_len`
- `deleted` / `deleted_len`

### `cberg_chunk_table_new(void)`

Allocates empty table (`next_id` starts at 1). Returns NULL on OOM.

### `cberg_chunk_table_free(cberg_chunk_table *table)`

Frees all stored chunks, hash map, change buffers, and table. NULL-safe.

### `cberg_chunk_table_fingerprint(const cberg_chunk_table *table, uint8_t out[CBERG_HASH_LEN])`

Copies last fingerprint computed by `sync`. Empty table → all-zero. NULL table/out → no-op.

### `cberg_chunk_table_len(const cberg_chunk_table *table)`

Current number of stored chunks. NULL → `0`.

### `cberg_chunk_table_at(const cberg_chunk_table *table, size_t index)`

Returns the stored chunk at `index`, or NULL when `table` is NULL or `index` is out of range.
Used by the Go daemon to build incremental sync snapshots.

### `cberg_chunk_table_find_by_id(const cberg_chunk_table *table, uint64_t id)`

Resolves a stored chunk by its stable `id` in O(1) via the internal id→index map.
Returns NULL when no live row has that id. Pointer valid until the next `sync` on the
same table (same lifetime as `cberg_chunk_table_at`). Use after vector search to map
neighbor ids back to chunk text.

### `cberg_chunk_table_sync(cberg_chunk_table *table, const cberg_chunk *incoming, size_t count, cberg_changes *out_changes)`

Diffs `incoming` (one file or batch) against the table using atomic staging — on failure the
table and prior change arrays are unchanged:

- **New key** → insert row, assign new `id`, append to `added`.
- **Existing key, different `content_hash`** → update row, same `id`, append to `modified`.
- **Existing key, same hash** → retained without a change list entry.
- **Duplicate keys in one `incoming` batch** → later rows update the staged row (not inserted twice).
- **Keys in table not in `incoming`** → remove row, append owned snapshot to `deleted`.

Recomputes set fingerprint on success. Change arrays are replaced only after a successful sync.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_OUT_OF_MEMORY`.

### `cberg_chunk_table_save(const cberg_chunk_table *table, const char *path)`

Persists the table to `path` (atomic write via temp file + rename). Format: magic
`CBT1`, version 1 — see [CBERG_INDEX.md](CBERG_INDEX.md#on-disk-artifacts).

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_IO`.

### `cberg_chunk_table_load(const char *path, cberg_chunk_table **out_table)`

Restores a table from `path`. On success `*out_table` is owned by the caller;
free with `cberg_chunk_table_free`. Restored ids match the saved snapshot so a
reopened vector index can warm-start without re-embedding unchanged chunks.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_IO`,
`CBERG_ERR_OUT_OF_MEMORY`, `CBERG_ERR_NOT_FOUND` (missing or incompatible file —
treat as cold start).

---

## Merkle manifest (content-derived change detection)

A Merkle tree over one repository's files: file bodies are XXH3-128 leaves, directory
nodes roll up their children's `(name, hash)` pairs via `cberg_fingerprint`. Detects
changes without filesystem-event watches — for many-repo scale where inotify watch
counts run out, and for reconciling after missed events. Use **one manifest per repo**.
Implementation: [modules/manifest.md](modules/manifest.md). Rationale:
[adr/0003-merkle-manifest-change-detection.md](adr/0003-merkle-manifest-change-detection.md).

### `cberg_manifest_entry`

```c
typedef struct cberg_manifest_entry {
    const char *path;            /* repo-relative */
    uint8_t hash[CBERG_HASH_LEN];/* XXH3-128 of the file bytes */
} cberg_manifest_entry;
```

### `cberg_manifest_changes`

```c
typedef struct cberg_manifest_changes {
    const char **added;    size_t added_len;     /* borrow from `next` */
    const char **modified; size_t modified_len;  /* borrow from `next` */
    const char **deleted;  size_t deleted_len;   /* borrow from `prev` */
} cberg_manifest_changes;
```

Path pointers stay valid until the manifest they borrow from is freed.

### `cberg_manifest_build(const char *root, cberg_manifest **out_manifest)`

Walks `root` (one repo), hashing every file body into a path-sorted leaf set, then folds
the leaves into a directory tree with rolled-up hashes. Skips dependency directories via
the watcher walk policy (`.git`, `node_modules`, …). Unreadable files are skipped, not
fatal. Empty repo ⇒ zero leaves, all-zero root.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT` (NULL arg), `CBERG_ERR_IO`
(`root` cannot be opened), `CBERG_ERR_OUT_OF_MEMORY`.

### `cberg_manifest_rebuild(const cberg_manifest *prev, const char *root, cberg_manifest **out_manifest)`

Incremental build. Reuses `prev`'s leaf hash for any file whose size and mtime match
`prev` (stat only, no read); only changed and new files are read and hashed. `prev`
may be NULL — then identical to `cberg_manifest_build`. `prev` is read-only and not
retained. **Caveat:** a same-size edit within the filesystem's mtime resolution can be
missed (stat-cache race); pair with an occasional full build (`prev = NULL`).

**Returns:** as `cberg_manifest_build`.

### `cberg_manifest_free(cberg_manifest *manifest)`

Releases the manifest (NULL-safe).

### `cberg_manifest_hashed_count(const cberg_manifest *manifest)`

Number of file bodies actually read and hashed in the build that produced this
manifest; the rest were reused from `prev`. Equals the leaf count for a full build, `0`
for a rebuild of an unchanged tree. For monitoring and tests.

### `cberg_manifest_root(const cberg_manifest *manifest, uint8_t out[CBERG_HASH_LEN])`

Writes the Merkle root. Equal roots from two builds imply identical content — the O(1)
"did this repo change at all" gate. All-zero for an empty repo.

### `cberg_manifest_len(const cberg_manifest *manifest)` / `cberg_manifest_at(const cberg_manifest *manifest, size_t index)`

Flat sorted leaf access — e.g. to bootstrap a cold index from every file. `at` returns
NULL when out of range; the pointer is valid until `free`.

### `cberg_manifest_diff(const cberg_manifest *prev, const cberg_manifest *next, cberg_manifest_changes *out_changes)`

File-level diff with subtree pruning: a directory whose rollup hash is unchanged is
skipped without inspecting its files. Reports `added` (only in `next`), `modified` (same
path, different hash), `deleted` (only in `prev`).

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_OUT_OF_MEMORY`.

### `cberg_manifest_diff_free(cberg_manifest_changes *changes)`

Frees the three path arrays (not the borrowed strings); NULL-safe.

### `cberg_manifest_save(const cberg_manifest *manifest, const char *path)`

Persists manifest leaves to `path` (atomic temp+rename). Format: magic `CBMF`,
version 1 — see [CBERG_INDEX.md](CBERG_INDEX.md#on-disk-artifacts).

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_IO`.

### `cberg_manifest_load(const char *path, cberg_manifest **out_manifest)`

Restores a manifest without re-reading the repository. A loaded manifest can
serve as the `prev` baseline for `cberg_manifest_rebuild` and `cberg_manifest_diff`
after a process restart.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_IO`,
`CBERG_ERR_OUT_OF_MEMORY`, `CBERG_ERR_NOT_FOUND` (missing or incompatible file —
treat as cold start).

---

## Repository walk policy

### `cberg_walk_skip_dir(const char *name)`

Returns non-zero when a directory basename should be excluded from repository tree
walks (`.git`, `node_modules`, …). Used by the manifest, watcher, and indexer. NULL or
empty → `0`.

---

## Filesystem watcher

### `cberg_watch_kind`

`MODIFY`, `CREATE`, `DELETE`, `RENAME`.

### `cberg_watch_event`

`kind` + `path` (repo-relative). Paths in poll output are strdup’d; **caller frees** each `events[i].path` after reading.

### `cberg_watcher_open(const char *root, cberg_watcher **out_watcher)`

Opens recursive watch on `root`. `root` must exist (`realpath` at open; `CBERG_ERR_IO`
if missing). **Symlink roots** are supported. **Symlinks inside** the tree are followed
when walking and registering watches. See also `CODEBERG_ROOT` / `cberg_config_*`.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_OUT_OF_MEMORY`, `CBERG_ERR_IO`.

### `cberg_watcher_close(cberg_watcher *watcher)`

Stops stream, closes inotify fd, frees dirty set and pending events. NULL-safe.

### `cberg_watcher_poll(...)`

Waits for backend activity, then **drains** the dirty set into `events` with accurate
`kind` per path (platform-native flags mapped to `CBERG_WATCH_*`). Debouncing coalesces
duplicate paths; `kind_merge` keeps DELETE, allows CREATE after DELETE (re-create before
drain), otherwise last event wins.

`events == NULL` with `cap == 0` → count/discard drain (clears dirty set, no path transfer).

Transfer mode is all-or-nothing: if more paths are pending than `cap`, returns
`CBERG_ERR_INVALID_ARGUMENT` without transferring or clearing.

**Shared drain:** `poll` and `dirty_paths` use one queue. Draining via either function
empties the set for both (unless transfer overflows `cap`).

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_IO`, `CBERG_ERR_TIMEOUT` (Linux), `CBERG_ERR_OUT_OF_MEMORY`.

### `cberg_watcher_dirty_paths(...)`

Drains the same dirty set as `poll`, paths only (no kinds). `paths[i]` are transferred
to caller — **free each** unless `paths == NULL` (count-only drain).

---

## Embedding

Requires build with ONNX Runtime (`CBERG_WITH_ONNX`).

### `cberg_embed_config`

| Field | Description |
|-------|-------------|
| `provider` | `CBERG_EMBED_ONNX` |
| `model_path` | Path to `model.onnx` |
| `num_threads` | ONNX intra-op threads; `<= 0` uses all cores |

Tokenizer files (`tokenizer.json`, etc.) must live in the same directory as the model.

### `cberg_embedder_open(const cberg_embed_config *config, cberg_embedder **out_embedder)`

Loads ONNX session and tokenizer. Discovers embedding dimension from model output shape.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_IO`, `CBERG_ERR_INTERNAL`, `CBERG_ERR_OUT_OF_MEMORY`, `CBERG_ERR_NOT_IMPLEMENTED`.

### `cberg_embedder_dim(const cberg_embedder *embedder)`

Vector dimension (768 for jina-embeddings-v2-base-code). NULL → `0`.

### `cberg_embedder_embed(cberg_embedder *embedder, const char *const *texts, const size_t *text_lens, size_t count, float **out_vectors)`

Embeds `count` texts. On success, `*out_vectors` is `count × dim` row-major floats (L2-normalized). Free with `cberg_vectors_free`.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_OUT_OF_MEMORY`, `CBERG_ERR_INTERNAL`, `CBERG_ERR_NOT_IMPLEMENTED`.

### `cberg_vectors_free(float *vectors)`

`free(vectors)`. NULL-safe.

### `cberg_embedder_close(cberg_embedder *embedder)`

Releases ONNX session, tokenizer, and embedder. NULL-safe.

---

## Vector index (usearch HNSW)

Requires `CBERG_WITH_USEARCH` at build time.

### `cberg_index_config`

| Field | Default | Meaning |
|-------|---------|---------|
| `connectivity` | 16 | HNSW graph degree |
| `expansion_add` | 128 | ef during insert |
| `expansion_search` | 64 | ef during search |

### `cberg_index_config_default(cberg_index_config *config)`

Fills defaults. NULL-safe no-op.

### `cberg_index_open(const char *path, size_t dim, const cberg_index_config *config, cberg_index **out_index)`

Opens or creates cosine HNSW index at `path`. Loads existing file if present; else reserves initial capacity. `config` may be NULL for defaults.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_IO`, `CBERG_ERR_INTERNAL`, `CBERG_ERR_OUT_OF_MEMORY`, `CBERG_ERR_NOT_IMPLEMENTED`.

### `cberg_index_add(cberg_index *index, uint64_t id, const float *vector)`

Insert or **replace** vector for `id` (`dim` floats). Grows index capacity as needed.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_INTERNAL`.

### `cberg_index_remove(cberg_index *index, uint64_t id)`

Removes `id`. **Returns:** `CBERG_OK`, `CBERG_ERR_NOT_FOUND`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_INTERNAL`.

### `cberg_index_search_opts`

`expansion_search` — per-query ef override; `0` uses index default.

### `cberg_index_search(cberg_index *index, const float *query, size_t k, const cberg_index_search_opts *opts, uint64_t *out_ids, float *out_scores, size_t *out_found)`

Nearest-neighbor search. Caller supplies `out_ids` and `out_scores` buffers of length at least `k`. Writes up to `k` results; `*out_found` is actual count. Scores are **cosine similarity** (1 − distance), descending.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_INTERNAL`.

### `cberg_index_save(cberg_index *index)`

Persists index to path given at open.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_IO`.

### `cberg_index_close(cberg_index *index)`

Frees usearch index and path copy. NULL-safe.

---

## Semantic search

### `cberg_search_config`

| Field | Default | Meaning |
|-------|---------|---------|
| `oversample` | 4 | ef = max(min_ef, k × oversample) |
| `min_expansion_search` | 64 | Floor for per-query ef |

### `cberg_search_config_default(cberg_search_config *config)`

Fills defaults.

### `cberg_search_query(cberg_embedder *embedder, cberg_index *index, const char *query, size_t query_len, const cberg_search_config *config, size_t k, uint64_t *out_ids, float *out_scores, size_t *out_found)`

1. Embeds query text.
2. Runs `cberg_index_search` with raised `expansion_search` for better recall.
3. Returns chunk ids and similarity scores.

`k == 0` → `*out_found = 0`, `CBERG_OK`.

**Returns:** same as embed + index search.

### `cberg_search_vector(cberg_index *index, const float *query_vec, const cberg_search_config *config, size_t k, uint64_t *out_ids, float *out_scores, size_t *out_found)`

Nearest-neighbor search using a **precomputed** query vector (`dim` floats,
L2-normalized like embedder output). Skips the ONNX embed step — use when one
query embedding must be searched against several indexes (multi-repo `cberg-index`
merges per-repo hits after a single embed). Applies the same `expansion_search`
policy as `cberg_search_query` via `config` (NULL → defaults).

`k == 0` → `*out_found = 0`, `CBERG_OK`.

**Returns:** `CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_INTERNAL`,
`CBERG_ERR_NOT_IMPLEMENTED`.

---

## Knowledge graph

Structural sidecar beside chunks/vectors ([ADR 0005](adr/0005-dual-index-graph.md)).
Full schema, confidence ladder, import resolution, and indexer wiring:
[modules/graph.md](modules/graph.md).

### Types

- `cberg_graph_node_kind` — `FILE`, `FUNCTION`, `METHOD`, `CLASS`, `STRUCT`,
  `INTERFACE`, `MODULE`
- `cberg_graph_edge_kind` — bit flags: `DEFINES`, `CONTAINS`, `IMPORTS`, `CALLS`,
  `INHERITS`, `REFERENCES` (`CBERG_GEDGE_ALL`)
- `cberg_graph_resolution` — `textual`, `import`, `typed`
- `cberg_graph_node` / `cberg_graph_edge` / `cberg_graph_hop` / `cberg_graph_hub`
- Opaque: `cberg_graph`, `cberg_graph_fragment`

### Lifecycle

| Function | Role |
|----------|------|
| `cberg_graph_new` / `cberg_graph_free` | Allocate / free store |
| `cberg_chunker_analyze` | One parse → chunk list + optional fragment |
| `cberg_graph_apply` | Replace one file’s subgraph (resolve defs via callback) |
| `cberg_graph_remove_file` | Drop a deleted file’s nodes and refs |
| `cberg_graph_save` / `cberg_graph_load` | Atomic `.graph` sidecar |

### Query

| Function | Role |
|----------|------|
| `cberg_graph_counts` | Live node / ref counts |
| `cberg_graph_node_by_id` | Lookup by id |
| `cberg_graph_find_nodes` | Exact name + kind mask + path prefix |
| `cberg_graph_edges_from` / `cberg_graph_edges_to` | Resolved edges (name refs linked at query time) |
| `cberg_graph_trace` | BFS (`CBERG_GRAPH_IN` / `OUT`, kind mask, max depth) |
| `cberg_graph_hubs` | Symbols ranked by full CALLS degree |
| `cberg_graph_resolve_imports` | Manifest/path rewrite of safe IMPORTS → FILE |

`cberg_graph_resolve_fn` maps chunk keys → stable ids (typically
`cberg_chunk_table_find_by_key`). Results truncate at `cap`; pointers from
`node_by_id` / `find_nodes` are valid until the next apply/remove/load.
