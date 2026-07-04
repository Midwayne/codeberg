/*
 * libcodeberg — performance core for codebase indexing.
 *
 * Chunking, change tracking, and filesystem watching. Incremental indexing is
 * watcher-driven: the library reacts to filesystem events, not scheduled
 * re-index passes.
 * A separate daemon may schedule git pull; that updates files on disk and the
 * watcher picks up the changes.
 *
 * Conventions:
 *   - Fallible functions return cberg_status; out-parameters are valid on OK.
 *   - Opaque handles are released by the matching *_close / *_free (NULL-safe).
 */
#ifndef CODEBERG_H
#define CODEBERG_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#if defined(_WIN32) || defined(__CYGWIN__)
#define CBERG_API __declspec(dllexport)
#else
#define CBERG_API __attribute__((visibility("default")))
#endif

/* --- Status ------------------------------------------------------------- */

typedef enum cberg_status {
    CBERG_OK = 0,
    CBERG_ERR_INVALID_ARGUMENT = 1,
    CBERG_ERR_INTERNAL = 2,
    CBERG_ERR_IO = 3,
    CBERG_ERR_UNSUPPORTED_LANGUAGE = 4,
    CBERG_ERR_NOT_FOUND = 5,
    CBERG_ERR_OUT_OF_MEMORY = 6,
    CBERG_ERR_TIMEOUT = 7,
    CBERG_ERR_NOT_IMPLEMENTED = 8,
} cberg_status;

CBERG_API const char *cberg_status_str(cberg_status status);
CBERG_API const char *cberg_version(void);

/* --- Configuration ------------------------------------------------------ */

/*
 * Environment variable for the codebase tree to index (not hardcoded in the library).
 * Example: export CODEBERG_ROOT=/path/to/your/repo
 */
#define CBERG_INDEX_ROOT_ENV "CODEBERG_ROOT"

/* Name of the index-root environment variable ("CODEBERG_ROOT"). */
CBERG_API const char *cberg_config_index_root_env_name(void);

/*
 * Value of CODEBERG_ROOT, or NULL when unset/empty. The pointer is valid until the
 * next setenv/unsetenv in this process; do not free.
 */
CBERG_API const char *cberg_config_index_root(void);

/*
 * Resolves CODEBERG_ROOT with realpath into out (symlink roots are allowed; the
 * physical target path is written). Returns CBERG_ERR_NOT_FOUND when unset.
 */
CBERG_API cberg_status cberg_config_resolve_index_root(char *out, size_t out_cap);

/* --- Hashing ------------------------------------------------------------ */

#define CBERG_HASH_LEN 32

/* XXH3-128 content digest (chunk bodies); zero-padded to CBERG_HASH_LEN. */
CBERG_API cberg_status cberg_hash(const void *data, size_t len, uint8_t out[CBERG_HASH_LEN]);

/*
 * Order-independent set fingerprint over (key, content_hash) pairs.
 * Sorts keys, streams key || 0x00 || content_hash into XXH3-128.
 */
CBERG_API cberg_status cberg_fingerprint(const char *const *keys, const uint8_t *const *hashes, size_t count,
                                         uint8_t out[CBERG_HASH_LEN]);

/* --- Languages & chunking ----------------------------------------------- */

typedef enum cberg_language {
    CBERG_LANG_UNKNOWN = 0,
    CBERG_LANG_GO,
    CBERG_LANG_TYPESCRIPT,
    CBERG_LANG_JAVASCRIPT,
    CBERG_LANG_C,
    CBERG_LANG_KOTLIN,
    CBERG_LANG_PYTHON,
    CBERG_LANG_JAVA,
} cberg_language;

CBERG_API cberg_language cberg_language_from_path(const char *path);

typedef enum cberg_chunk_kind {
    CBERG_CHUNK_UNKNOWN = 0,
    CBERG_CHUNK_FUNCTION,
    CBERG_CHUNK_METHOD,
    CBERG_CHUNK_CLASS,
    CBERG_CHUNK_STRUCT,
    CBERG_CHUNK_INTERFACE,
    CBERG_CHUNK_WINDOW,
} cberg_chunk_kind;

typedef struct cberg_span {
    uint32_t start_byte;
    uint32_t end_byte;
    uint32_t start_line;
    uint32_t end_line;
} cberg_span;

typedef struct cberg_chunk {
    uint8_t content_hash[CBERG_HASH_LEN];
    cberg_span span;
    cberg_chunk_kind kind;
    const char *key; /* stable identity: "<path>::<kind>::<symbol>#<n>" */
    const char *path;
    const char *symbol; /* may be NULL */
} cberg_chunk;

typedef struct cberg_chunk_list cberg_chunk_list;

/*
 * Reusable chunker: keeps tree-sitter parsers and queries warm per language.
 * Create one per worker thread and reuse across files.
 */
typedef struct cberg_chunker cberg_chunker;

CBERG_API cberg_status cberg_chunker_open(cberg_chunker **out_chunker);
CBERG_API void cberg_chunker_close(cberg_chunker *chunker);

/*
 * Parse source into logical chunks (functions, methods, types, …). For unknown
 * languages, falls back to fixed-size line windows. Symbol strings and keys
 * are owned by the returned list.
 */
CBERG_API cberg_status cberg_chunker_parse(cberg_chunker *chunker, cberg_language lang, const char *path,
                                            const char *src, size_t src_len, cberg_chunk_list **out_list);

CBERG_API size_t cberg_chunk_list_len(const cberg_chunk_list *list);
CBERG_API const cberg_chunk *cberg_chunk_list_at(const cberg_chunk_list *list, size_t index);
CBERG_API void cberg_chunk_list_free(cberg_chunk_list *list);

/*
 * Convenience: hash each chunk body from `src` and fill content_hash fields.
 * The list must have been produced by cberg_chunker_parse for the same buffer.
 */
CBERG_API cberg_status cberg_chunk_list_hash_bodies(const cberg_chunk_list *list, const char *src, size_t src_len);

/* --- Chunk table (in-memory change tracking) ---------------------------- */

typedef struct cberg_chunk_table cberg_chunk_table;

typedef struct cberg_stored_chunk {
    uint64_t id;
    cberg_chunk chunk;
} cberg_stored_chunk;

typedef struct cberg_changes {
    cberg_stored_chunk *added;
    size_t added_len;
    cberg_stored_chunk *modified;
    size_t modified_len;
    cberg_stored_chunk *deleted;
    size_t deleted_len;
} cberg_changes;

CBERG_API cberg_chunk_table *cberg_chunk_table_new(void);
CBERG_API void cberg_chunk_table_free(cberg_chunk_table *table);

/* Returns the last computed set fingerprint (all-zero when empty). */
CBERG_API void cberg_chunk_table_fingerprint(const cberg_chunk_table *table, uint8_t out[CBERG_HASH_LEN]);

CBERG_API size_t cberg_chunk_table_len(const cberg_chunk_table *table);

/* Valid until the next sync on the same table. Returns NULL when out of range. */
CBERG_API const cberg_stored_chunk *cberg_chunk_table_at(const cberg_chunk_table *table, size_t index);

/*
 * Resolve a stored chunk by its stable id in O(1) (search maps neighbor ids back
 * to chunks). Returns NULL when no live chunk has that id. The pointer is valid
 * until the next sync on the same table, same as cberg_chunk_table_at.
 */
CBERG_API const cberg_stored_chunk *cberg_chunk_table_find_by_id(const cberg_chunk_table *table, uint64_t id);

/*
 * Diff `incoming` against the table. IDs are stable across modifications.
 * Change arrays are owned by the table until the next sync or free.
 * On non-OK return the table and prior change arrays are unchanged.
 */
CBERG_API cberg_status cberg_chunk_table_sync(cberg_chunk_table *table, const cberg_chunk *incoming, size_t count,
                                              cberg_changes *out_changes);

/*
 * Persist / restore the table to `path` (atomic temp+rename). Restoring keeps
 * chunk ids stable across process restarts, so a reopened vector index reuses
 * the embeddings it already holds instead of re-embedding every chunk: a warm
 * start re-embeds only the chunks whose content actually changed.
 * cberg_chunk_table_load returns CBERG_ERR_NOT_FOUND when `path` is absent or was
 * written by an incompatible version (treat as a cold start). On OK, *out_table
 * owns a new table; free it with cberg_chunk_table_free.
 */
CBERG_API cberg_status cberg_chunk_table_save(const cberg_chunk_table *table, const char *path);
CBERG_API cberg_status cberg_chunk_table_load(const char *path, cberg_chunk_table **out_table);

/* --- Merkle manifest (content-derived change detection) ----------------- */

/*
 * A Merkle tree over one repository's files. Leaves are file bodies hashed with
 * XXH3-128; directory nodes roll up the (name, hash) pairs of their children.
 * The root hash is a single digest over the whole tree.
 *
 * This detects what changed without relying on filesystem-event watches (which
 * are bounded by inotify limits across many repos): equal root hashes mean the
 * tree is unchanged, and the diff descends only into subtrees whose rollup hash
 * differs. Intended for one manifest per repo; compare a freshly built manifest
 * against the last-indexed one (e.g. after a git pull) to drive re-chunking.
 */
typedef struct cberg_manifest cberg_manifest;

/* One file leaf: repo-relative path and the XXH3-128 hash of its bytes. */
typedef struct cberg_manifest_entry {
    uint8_t hash[CBERG_HASH_LEN];
    const char *path;
} cberg_manifest_entry;

/*
 * Walks `root` (a single repository) and builds a manifest. Skips dependency
 * directories via cberg_walk_skip_dir (.git, node_modules, …). Unreadable
 * files are skipped, not fatal. Leaves are sorted by repo-relative path.
 * Returns CBERG_ERR_IO when `root` itself cannot be opened.
 */
CBERG_API cberg_status cberg_manifest_build(const char *root, cberg_manifest **out_manifest);

/*
 * Incremental rebuild: like cberg_manifest_build, but reuses `prev`'s leaf hash
 * for any file whose size and mtime match `prev` (stat only, no read). Only
 * changed and new files are read and hashed; `prev` may be NULL (full build,
 * identical to cberg_manifest_build). `prev` is read-only and not retained.
 *
 * Caveat: a content edit that preserves file size within the filesystem's mtime
 * resolution can be missed (the classic stat-cache race). Pair frequent rebuilds
 * with an occasional full build (prev = NULL) to self-heal.
 */
CBERG_API cberg_status cberg_manifest_rebuild(const cberg_manifest *prev, const char *root,
                                              cberg_manifest **out_manifest);

CBERG_API void cberg_manifest_free(cberg_manifest *manifest);

/* Number of file bodies actually read and hashed in the build that produced this
 * manifest; the remainder were reused from `prev`. Equals the leaf count for a
 * full build. A rebuild of an unchanged tree returns 0. */
CBERG_API size_t cberg_manifest_hashed_count(const cberg_manifest *manifest);

/* Merkle root over the whole tree; all-zero for an empty repo. Two builds with
 * identical file contents produce equal roots. */
CBERG_API void cberg_manifest_root(const cberg_manifest *manifest, uint8_t out[CBERG_HASH_LEN]);

/* Flat sorted leaf access — e.g. to bootstrap a cold index from every file. */
CBERG_API size_t cberg_manifest_len(const cberg_manifest *manifest);
CBERG_API const cberg_manifest_entry *cberg_manifest_at(const cberg_manifest *manifest, size_t index);

/*
 * File-level diff between two manifests of the same repo. Path pointers in
 * `added`/`modified` borrow from `next`; those in `deleted` borrow from `prev`
 * — all valid until either manifest is freed. Subtrees whose directory rollup
 * hash is unchanged are skipped without inspecting their files.
 */
typedef struct cberg_manifest_changes {
    const char **added;
    size_t added_len;
    const char **modified;
    size_t modified_len;
    const char **deleted;
    size_t deleted_len;
} cberg_manifest_changes;

CBERG_API cberg_status cberg_manifest_diff(const cberg_manifest *prev, const cberg_manifest *next,
                                           cberg_manifest_changes *out_changes);
CBERG_API void cberg_manifest_diff_free(cberg_manifest_changes *changes);

/*
 * Persist / restore a manifest to `path` (atomic temp+rename). Restoring rebuilds
 * the directory tree from the saved leaves without reading the repository, so a
 * loaded manifest serves as the `prev` baseline for cberg_manifest_rebuild and
 * cberg_manifest_diff after a restart — letting a process detect what changed
 * while it was down. cberg_manifest_load returns CBERG_ERR_NOT_FOUND when `path`
 * is absent or incompatible (treat as a cold start).
 */
CBERG_API cberg_status cberg_manifest_save(const cberg_manifest *manifest, const char *path);
CBERG_API cberg_status cberg_manifest_load(const char *path, cberg_manifest **out_manifest);

/* --- Repository walk policy --------------------------------------------- */

/*
 * Returns non-zero when a directory basename should be excluded from repository
 * tree walks (.git, node_modules, …). Used by the manifest, watcher, and indexer.
 */
CBERG_API int cberg_walk_skip_dir(const char *name);

/* --- Filesystem watcher ------------------------------------------------- */

typedef enum cberg_watch_kind {
    CBERG_WATCH_MODIFY = 1,
    CBERG_WATCH_CREATE = 2,
    CBERG_WATCH_DELETE = 3,
    CBERG_WATCH_RENAME = 4,
} cberg_watch_kind;

typedef struct cberg_watch_event {
    cberg_watch_kind kind;
    const char *path; /* repo-relative */
} cberg_watch_event;

typedef struct cberg_watcher cberg_watcher;

/*
 * Indexing trigger: recursively watch `root` and accumulate dirty paths.
 * `root` may be a symlink; it is resolved with realpath at open (target must exist).
 * Symlinked directories inside the tree are followed and indexed. Skips VCS metadata
 * and common dependency trees (.git, node_modules, …) via the watcher walk policy.
 * New directories are registered automatically.
 *
 * Thread safety: safe to call poll/dirty_paths from one thread while the platform
 * delivers events asynchronously (macOS FSEvents). Do not call poll/dirty_paths
 * concurrently from multiple threads.
 */
CBERG_API cberg_status cberg_watcher_open(const char *root, cberg_watcher **out_watcher);
CBERG_API void cberg_watcher_close(cberg_watcher *watcher);

/*
 * Blocks up to `timeout_ms` (0 = non-blocking poll). Drains the debounced dirty-path
 * set into `events` (path + kind). *out_count is the number written (or the total
 * drained when `events` is NULL — count/discard mode). Transfer mode is all-or-nothing:
 * if more paths are pending than `cap`, returns CBERG_ERR_INVALID_ARGUMENT, writes
 * nothing (*out_count stays 0), and leaves the dirty set intact. Caller frees each
 * events[i].path on success.
 *
 * If the watcher records an internal error (e.g. out of memory while tracking a
 * path), subsequent poll/dirty_paths calls return that status until close.
 *
 * Shares the same dirty set as cberg_watcher_dirty_paths — do not call both expecting
 * independent queues; whichever drains first consumes all pending paths.
 */
CBERG_API cberg_status cberg_watcher_poll(cberg_watcher *watcher, cberg_watch_event *events, size_t cap,
                                          size_t *out_count, int timeout_ms);

/*
 * Drains the debounced dirty-path set into `paths` (repo-relative pointers only;
 * no event kind — use poll for CREATE/DELETE/RENAME/MODIFY).
 *
 * When `paths` is NULL, discards path strings and sets *out_count to the number
 * drained (cap is ignored). When `paths` is non-NULL, transfer is all-or-nothing
 * (same cap overflow rules as poll).
 *
 * Same backing set as poll: calling poll first leaves nothing for dirty_paths, and
 * vice versa. paths[i] are heap-owned; caller frees each.
 */
CBERG_API cberg_status cberg_watcher_dirty_paths(cberg_watcher *watcher, const char **paths, size_t cap,
                                                   size_t *out_count);

/* --- Embedding ---------------------------------------------------------- */

typedef enum cberg_embed_provider {
    CBERG_EMBED_ONNX = 0,
} cberg_embed_provider;

typedef struct cberg_embed_config {
    cberg_embed_provider provider;
    const char *model_path; /* ONNX: path to model.onnx */
    int num_threads;        /* ONNX intra-op threads; <= 0 uses all cores */
} cberg_embed_config;

typedef struct cberg_embedder cberg_embedder;

CBERG_API cberg_status cberg_embedder_open(const cberg_embed_config *config, cberg_embedder **out_embedder);
CBERG_API size_t cberg_embedder_dim(const cberg_embedder *embedder);

/*
 * Embeds `count` texts. On success writes a contiguous count*dim float array to
 * *out_vectors (row-major); free with cberg_vectors_free.
 */
CBERG_API cberg_status cberg_embedder_embed(cberg_embedder *embedder, const char *const *texts,
                                            const size_t *text_lens, size_t count, float **out_vectors);
CBERG_API void cberg_vectors_free(float *vectors);
CBERG_API void cberg_embedder_close(cberg_embedder *embedder);

/* --- Vector index (usearch HNSW) ---------------------------------------- */

typedef struct cberg_index cberg_index;

typedef struct cberg_index_config {
    size_t connectivity;      /* HNSW graph degree (default 16) */
    size_t expansion_add;     /* ef during insert (default 128) */
    size_t expansion_search;  /* ef during search (default 64) */
} cberg_index_config;

/* Fills defaults; pass the result to cberg_index_open (config may be NULL). */
CBERG_API void cberg_index_config_default(cberg_index_config *config);

/* Opens (creating if absent) an HNSW cosine index of dimension `dim` at `path`. */
CBERG_API cberg_status cberg_index_open(const char *path, size_t dim, const cberg_index_config *config,
                                        cberg_index **out_index);

CBERG_API cberg_status cberg_index_add(cberg_index *index, uint64_t id, const float *vector);
CBERG_API cberg_status cberg_index_remove(cberg_index *index, uint64_t id);

typedef struct cberg_index_search_opts {
    size_t expansion_search; /* 0 = use index default */
} cberg_index_search_opts;

CBERG_API cberg_status cberg_index_search(cberg_index *index, const float *query, size_t k,
                                          const cberg_index_search_opts *opts, uint64_t *out_ids, float *out_scores,
                                          size_t *out_found);

CBERG_API cberg_status cberg_index_save(cberg_index *index);
CBERG_API void cberg_index_close(cberg_index *index);

/* --- Semantic search (embed query + nearest neighbors) -------------------- */

typedef struct cberg_search_config {
    size_t oversample;          /* search ef multiplier: max(min_ef, k * oversample); default 4 */
    size_t min_expansion_search; /* floor for per-query ef; default 64 */
} cberg_search_config;

CBERG_API void cberg_search_config_default(cberg_search_config *config);

/*
 * Embeds `query`/`query_len`, then searches the index for `k` neighbors.
 * Scores are cosine similarity (1 minus distance), best-first.
 */
CBERG_API cberg_status cberg_search_query(cberg_embedder *embedder, cberg_index *index, const char *query,
                                          size_t query_len, const cberg_search_config *config, size_t k,
                                          uint64_t *out_ids, float *out_scores, size_t *out_found);

/*
 * Searches the index for `k` neighbors of an already-embedded query vector
 * (same scoring and ef policy as cberg_search_query). Lets one query embedding
 * be searched against several indexes without re-paying the embed.
 */
CBERG_API cberg_status cberg_search_vector(cberg_index *index, const float *query_vec,
                                           const cberg_search_config *config, size_t k, uint64_t *out_ids,
                                           float *out_scores, size_t *out_found);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* CODEBERG_H */
