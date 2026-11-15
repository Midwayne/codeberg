#define _POSIX_C_SOURCE 200809L

#include "indexer_internal.h"

#include "pathutil.h"

#include <stdio.h>
#include <stdlib.h>

typedef struct {
    cberg_repo *repo;
    chunk_batch *batch;
    cberg_status err;
    size_t files;
} walk_ctx;

static int bootstrap_cb(const char *abs, const char *rel, void *v) {
    walk_ctx *ctx = v;
    if (++ctx->files % 1000 == 0) {
        fprintf(stderr, "cberg-index[%s]: scanned %zu files...\n", ctx->repo->key, ctx->files);
    }

    /* The total is unknown until the walk ends; report files seen so far so
     * the scan shows movement instead of an empty meter. */
    atomic_store(&ctx->repo->progress_completed, ctx->files);
    cberg_chunk_list *list = NULL;
    cberg_graph_fragment *frag = NULL;
    cberg_status st = repo_parse_file(ctx->repo, abs, rel, &list, &frag);
    if (st != CBERG_OK) {
        ctx->err = st;
        return -1;
    }
    if (list == NULL) {
        return 0;
    }
    st = chunk_batch_add_list(ctx->batch, list);
    if (st != CBERG_OK) {
        cberg_chunk_list_free(list);
        cberg_graph_fragment_free(frag);
        ctx->err = st;
        return -1;
    }
    st = chunk_batch_add_fragment(ctx->batch, frag); /* batch owns frag on success */
    if (st != CBERG_OK) {
        cberg_graph_fragment_free(frag);
        ctx->err = st;
        return -1;
    }
    return 0;
}

/* Walk every file, chunk it, and capture a manifest baseline for next time. The
 * caller holds r->mu. Used both on a true cold start (empty table) and as the
 * fallback when a chunk table was restored but no manifest was: in the latter
 * case unchanged chunks still keep their ids, so sync re-embeds nothing. */
static cberg_status walk_and_sync(cberg_repo *r) {
    chunk_batch batch;
    chunk_batch_init(&batch);
    walk_ctx ctx = {.repo = r, .batch = &batch};
    if (cberg_fs_walk_files(r->root, bootstrap_cb, &ctx) != 0) {
        chunk_batch_reset(&batch);
        return ctx.err != CBERG_OK ? ctx.err : CBERG_ERR_IO;
    }
    cberg_status st = repo_sync_table(r, &batch);
    chunk_batch_reset(&batch);
    if (st != CBERG_OK) {
        return st;
    }
    if (r->manifest_path != NULL) {
        cberg_manifest *m = NULL;
        if (cberg_manifest_build(r->root, &m) == CBERG_OK) {
            cberg_manifest_free(r->manifest);
            r->manifest = m;
        } else {
            fprintf(stderr, "cberg-index[%s]: warning: manifest build failed; restarts will re-scan all files\n", r->key);
        }
    }
    repo_resolve_imports(r);
    return CBERG_OK;
}

typedef struct {
    cberg_repo *repo;
    cberg_status err;
} graph_walk_ctx;

static int graph_rebuild_cb(const char *abs, const char *rel, void *v) {
    graph_walk_ctx *ctx = v;
    cberg_chunk_list *list = NULL;
    cberg_graph_fragment *frag = NULL;
    cberg_status st = repo_parse_file(ctx->repo, abs, rel, &list, &frag);
    if (st != CBERG_OK) {
        ctx->err = st;
        return -1;
    }
    if (frag != NULL) {
        st = cberg_graph_apply(ctx->repo->graph, frag, repo_graph_key_resolver, ctx->repo->table);
        if (st != CBERG_OK) {
            fprintf(stderr, "cberg-index[%s]: warning: graph rebuild failed for '%s': %s\n", ctx->repo->key, rel, cberg_status_str(st));
        }
        cberg_graph_fragment_free(frag);
    }
    cberg_chunk_list_free(list);
    return 0;
}

/* Full graph re-extraction from source. Used when the chunk table restored
 * warm but the .graph sidecar is missing or incompatible: chunks and vectors
 * stay warm, only the structural pass re-runs (no ONNX involved). Caller
 * holds r->mu and has already synced the chunk table. */
static void rebuild_graph(cberg_repo *r) {
    if (r->graph == NULL) {
        return;
    }
    fprintf(stderr, "cberg-index[%s]: graph sidecar missing or stale; re-extracting\n", r->key);
    repo_progress_begin(r, "graph", 0, 0);
    graph_walk_ctx ctx = {.repo = r};
    if (cberg_fs_walk_files(r->root, graph_rebuild_cb, &ctx) != 0) {
        fprintf(stderr, "cberg-index[%s]: warning: graph rebuild walk failed (%s); graph is partial\n", r->key, cberg_status_str(ctx.err != CBERG_OK ? ctx.err : CBERG_ERR_IO));
    }
    repo_resolve_imports(r);
}

static cberg_status bootstrap_warm(cberg_repo *r) {
    cberg_chunk_table *restored = NULL;
    cberg_status st = cberg_chunk_table_load(r->chunks_path, &restored);
    if (st != CBERG_OK) {
        return st; /* NOT_FOUND -> cold start; a real error propagates */
    }
    cberg_chunk_table_free(r->table);
    r->table = restored;

    /* Restore the graph sidecar; a missing or incompatible snapshot re-extracts
     * from source once the chunk table is settled (walk_and_sync paths rebuild
     * it as a side effect of re-parsing every file). */
    int graph_stale = 0;
    if (r->graph != NULL && r->graph_path != NULL) {
        cberg_graph *loaded = NULL;
        if (cberg_graph_load(r->graph_path, &loaded) == CBERG_OK) {
            cberg_graph_free(r->graph);
            r->graph = loaded;
        } else {
            graph_stale = 1;
        }
    }

    cberg_manifest *prev = NULL;
    if (r->manifest_path != NULL && cberg_manifest_load(r->manifest_path, &prev) != CBERG_OK) {
        prev = NULL;
    }

    /* Chunk table but no manifest baseline: we still avoid re-embedding (ids were
     * restored), but must walk + re-chunk every file to learn what changed. */
    if (prev == NULL) {
        st = walk_and_sync(r);
        if (st == CBERG_OK) {
            repo_save_state(r);
        }
        return st;
    }

    /* Manifest-driven: diff the saved tree against a fresh rebuild (stat-only for
     * unchanged files) and re-chunk only added/modified, dropping deleted. */
    cberg_manifest *next = NULL;
    st = cberg_manifest_rebuild(prev, r->root, &next);
    if (st != CBERG_OK) {
        cberg_manifest_free(prev);
        return st;
    }
    cberg_manifest_changes diff = {0};
    st = cberg_manifest_diff(prev, next, &diff);
    if (st != CBERG_OK) {
        cberg_manifest_free(prev);
        cberg_manifest_free(next);
        return st;
    }

    size_t rechunk_n = diff.added_len + diff.modified_len;
    char **rechunk = NULL;
    if (rechunk_n > 0) {
        rechunk = malloc(rechunk_n * sizeof(*rechunk));
        if (rechunk == NULL) {
            cberg_manifest_diff_free(&diff);
            cberg_manifest_free(prev);
            cberg_manifest_free(next);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        size_t rn = 0;
        for (size_t i = 0; i < diff.added_len; i++) {
            rechunk[rn++] = (char *)diff.added[i];
        }
        for (size_t i = 0; i < diff.modified_len; i++) {
            rechunk[rn++] = (char *)diff.modified[i];
        }
    }

    /* diff paths borrow from prev/next; consume them before either is freed. */
    st = repo_apply_path_changes(r, rechunk, rechunk_n, (char **)diff.deleted, diff.deleted_len);
    free(rechunk);
    if (st == CBERG_OK) {
        fprintf(stderr, "cberg-index[%s]: warm restart: %zu added, %zu modified, %zu deleted since last run\n", r->key, diff.added_len, diff.modified_len, diff.deleted_len);
    }
    cberg_manifest_diff_free(&diff);
    cberg_manifest_free(prev);
    if (st != CBERG_OK) {
        cberg_manifest_free(next);
        return st;
    }

    cberg_manifest_free(r->manifest);
    r->manifest = next; /* the fresh tree becomes the new baseline */
    if (graph_stale) {
        rebuild_graph(r); /* diff only re-parsed changed files; cover the rest */
    } else {
        repo_resolve_imports(r);
    }
    repo_save_state(r);
    return CBERG_OK;
}

cberg_status cberg_repo_bootstrap(cberg_repo *r) {
    pthread_mutex_lock(&r->mu);
    atomic_store(&r->progress_active, 1);
    repo_progress_begin(r, "counting", 0, 0);

    /* Warm path first: when a prior chunk table is on disk, reuse it so unchanged
     * chunks keep their ids (and embeddings). NOT_FOUND means there is no prior
     * state, so fall through to a cold build. */
    cberg_status st = CBERG_ERR_NOT_FOUND;
    if (r->chunks_path != NULL) {
        st = bootstrap_warm(r);
        if (st != CBERG_ERR_NOT_FOUND) {
            if (st == CBERG_OK) {
                r->ready = 1;
            }
            repo_publish_status(r);
            atomic_store(&r->progress_active, 0);
            pthread_mutex_unlock(&r->mu);
            return st;
        }
    }

    st = walk_and_sync(r);
    if (st == CBERG_OK) {
        r->ready = 1;
        repo_save_state(r);
    }
    repo_publish_status(r);
    atomic_store(&r->progress_active, 0);
    pthread_mutex_unlock(&r->mu);
    return st;
}
