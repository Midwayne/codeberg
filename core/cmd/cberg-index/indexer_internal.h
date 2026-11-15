#ifndef CBERG_INDEXER_INTERNAL_H
#define CBERG_INDEXER_INTERNAL_H

/*
 * Shared between the indexer's translation units; nothing outside
 * cmd/cberg-index includes this. The engine API itself is in indexer.h.
 *
 *   engine.c        engine + repo lifecycle (open, close, lookup)
 *   bootstrap.c     cold and warm start of one repo
 *   watch_loop.c    incremental updates from the file watchers
 *   repo_sync.c     parse files, commit chunks and graph fragments
 *   repo_vectors.c  embed changed chunks into the vector index
 *   repo_state.c    progress, published status, sidecar persistence
 *   chunk_batch.c   the set of chunks handed to one sync
 *   query_chunks.c  search, chunk, symbol, and outline queries
 *   query_graph.c   knowledge-graph queries
 *
 * Unless noted otherwise, repo_* functions expect the caller to hold r->mu.
 */

#include "indexer.h"

/* ------------------------------------------------------------ chunk batch */

/* Chunks (and their graph fragments) collected for one chunk-table sync.
 * `items` are shallow copies whose strings are owned by `lists` or, for rows
 * carried over unchanged, by the repo's chunk table. */
typedef struct {
    cberg_chunk *items;
    size_t len;
    size_t cap;
    cberg_chunk_list **lists;
    size_t lists_len;
    size_t lists_cap;
    cberg_graph_fragment **frags; /* per-file graph fragments, applied after sync */
    size_t frags_len;
    size_t frags_cap;
} chunk_batch;

void chunk_batch_init(chunk_batch *b);
void chunk_batch_reset(chunk_batch *b);

/* Add one parsed file. Takes ownership of both arguments, also on failure;
 * a NULL list (the file yields no chunks) adds nothing. */
cberg_status chunk_batch_add_file(chunk_batch *b, cberg_chunk_list *list, cberg_graph_fragment *frag);

/* Carry over every chunk in the repo's table except those under `skip` paths. */
cberg_status chunk_batch_add_table_except(cberg_repo *r, chunk_batch *batch, char **skip, size_t skip_n);

/* --------------------------------------------------- progress and status */

/* One indexing thread writes progress; health readers never take repo locks.
 * A zero total means the parsing pass has not determined its workload yet. */
void repo_progress_begin(cberg_repo *r, const char *phase, size_t total, size_t completed);

/* Publish chunk count and readiness after a bootstrap/watch pass, including
 * failed passes. */
void repo_publish_status(cberg_repo *r);

/* ------------------------------------------------------------ persistence */

/* Best-effort: failures are logged and leave the previous sidecar in place. */
void repo_save_chunk_table(cberg_repo *r);
void repo_save_graph(cberg_repo *r);
void repo_save_state(cberg_repo *r); /* chunk table + manifest + graph */

void repo_refresh_manifest(cberg_repo *r);
void repo_resolve_imports(cberg_repo *r);

/* ------------------------------------------------------------------- sync */

/* Chunk one file and, when the repo has a graph, extract its fragment.
 * *out is NULL when the file yields no chunks. Only OOM is an error. */
cberg_status repo_parse_file(cberg_repo *r, const char *abs, const char *rel, cberg_chunk_list **out, cberg_graph_fragment **out_frag);

/* cberg_graph_apply resolver backed by a chunk table (ctx). */
cberg_status repo_graph_key_resolver(void *ctx, const char *key, uint64_t *out_id);

/* Commit the batch to the chunk table and graph, then embed what changed. */
cberg_status repo_sync_table(cberg_repo *r, chunk_batch *batch);

/* The two halves of repo_sync_table, for callers that drop graph paths between. */
cberg_status repo_sync_chunks(cberg_repo *r, chunk_batch *batch, cberg_changes *out_ch);
cberg_status repo_sync_vectors(cberg_repo *r, const cberg_changes *ch);

/* Re-index `rechunk` paths from disk and drop `deleted` ones. Both arrays are
 * borrowed. */
cberg_status repo_apply_path_changes(cberg_repo *r, char **rechunk, size_t rechunk_n, char **deleted, size_t deleted_n);

/* ----------------------------------------------------------------- lookup */

/* NULL when repo_key is NULL, empty, or unknown. */
cberg_repo *engine_find_repo(cberg_engine *eng, const char *repo_key);

#endif
