#define _POSIX_C_SOURCE 200809L

#include "indexer_internal.h"

#include "pathutil.h"

#include <stdio.h>
#include <stdlib.h>

/* ------------------------------------------------------------- cold start */

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
    if (st == CBERG_OK) {
        st = chunk_batch_add_file(ctx->batch, list, frag);
    }

    if (st != CBERG_OK) {
        ctx->err = st;
        return -1;
    }
    return 0;
}

/* Capture the tree as the baseline the next restart diffs against. */
static void build_manifest(cberg_repo *r) {
    if (r->manifest_path == NULL) {
        return;
    }

    cberg_manifest *built = NULL;
    if (cberg_manifest_rebuild_ex(NULL, r->root, &r->exclusions, &built) != CBERG_OK) {
        fprintf(stderr, "cberg-index[%s]: warning: manifest build failed; restarts will re-scan all files\n", r->key);
        return;
    }

    cberg_manifest_free(r->manifest);
    r->manifest = built;
}

/* Walk every file, chunk it, and capture a manifest baseline for next time.
 * Used both on a true cold start (empty table) and as the fallback when a
 * chunk table was restored but no manifest was: in the latter case unchanged
 * chunks still keep their ids, so sync re-embeds nothing. */
static cberg_status walk_and_sync(cberg_repo *r) {
    chunk_batch batch;
    chunk_batch_init(&batch);

    walk_ctx ctx = {.repo = r, .batch = &batch};
    if (cberg_fs_walk_files(r->root, &r->exclusions, bootstrap_cb, &ctx) != 0) {
        chunk_batch_reset(&batch);
        return ctx.err != CBERG_OK ? ctx.err : CBERG_ERR_IO;
    }

    cberg_status st = repo_sync_table(r, &batch);
    chunk_batch_reset(&batch);
    if (st != CBERG_OK) {
        return st;
    }

    build_manifest(r);
    repo_resolve_imports(r);
    return CBERG_OK;
}

/* ---------------------------------------------------------- graph rebuild */

typedef struct {
    cberg_repo *repo;
    cberg_status err;
} graph_walk_ctx;

static int graph_rebuild_cb(const char *abs, const char *rel, void *v) {
    graph_walk_ctx *ctx = v;
    cberg_repo *r = ctx->repo;

    cberg_chunk_list *list = NULL;
    cberg_graph_fragment *frag = NULL;
    cberg_status st = repo_parse_file(r, abs, rel, &list, &frag);
    if (st != CBERG_OK) {
        ctx->err = st;
        return -1;
    }

    if (frag != NULL) {
        st = cberg_graph_apply(r->graph, frag, repo_graph_key_resolver, r->table);
        if (st != CBERG_OK) {
            fprintf(stderr, "cberg-index[%s]: warning: graph rebuild failed for '%s': %s\n", r->key, rel, cberg_status_str(st));
        }
        cberg_graph_fragment_free(frag);
    }
    cberg_chunk_list_free(list);
    return 0;
}

/* Full graph re-extraction from source. Used when the chunk table restored
 * warm but the .graph sidecar is missing or incompatible: chunks and vectors
 * stay warm, only the structural pass re-runs (no ONNX involved). The chunk
 * table must already be synced. */
static void rebuild_graph(cberg_repo *r) {
    if (r->graph == NULL) {
        return;
    }

    fprintf(stderr, "cberg-index[%s]: graph sidecar missing or stale; re-extracting\n", r->key);
    repo_progress_begin(r, "graph", 0, 0);

    graph_walk_ctx ctx = {.repo = r};
    if (cberg_fs_walk_files(r->root, &r->exclusions, graph_rebuild_cb, &ctx) != 0) {
        cberg_status why = ctx.err != CBERG_OK ? ctx.err : CBERG_ERR_IO;
        fprintf(stderr, "cberg-index[%s]: warning: graph rebuild walk failed (%s); graph is partial\n", r->key, cberg_status_str(why));
    }
    repo_resolve_imports(r);
}

/* ------------------------------------------------------------- warm start */

/* Swap in the graph sidecar. Returns 0 when the repo keeps a graph on disk
 * but the snapshot is missing or incompatible. */
static int restore_graph(cberg_repo *r) {
    if (r->graph == NULL || r->graph_path == NULL) {
        return 1;
    }

    cberg_graph *loaded = NULL;
    if (cberg_graph_load(r->graph_path, &loaded) != CBERG_OK) {
        return 0;
    }

    cberg_graph_free(r->graph);
    r->graph = loaded;
    return 1;
}

static cberg_manifest *load_manifest(const cberg_repo *r) {
    cberg_manifest *saved = NULL;
    if (r->manifest_path == NULL || cberg_manifest_load(r->manifest_path, &saved) != CBERG_OK) {
        return NULL;
    }
    return saved;
}

/* Re-chunk what the diff added or modified and drop what it deleted. The
 * diff's paths borrow from the manifests it compared; both must outlive
 * this call. */
static cberg_status apply_manifest_diff(cberg_repo *r, const cberg_manifest_changes *diff) {
    size_t rechunk_n = diff->added_len + diff->modified_len;
    char **rechunk = NULL;

    if (rechunk_n > 0) {
        rechunk = malloc(rechunk_n * sizeof(*rechunk));
        if (rechunk == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }

        size_t n = 0;
        for (size_t i = 0; i < diff->added_len; i++) {
            rechunk[n++] = (char *)diff->added[i];
        }
        for (size_t i = 0; i < diff->modified_len; i++) {
            rechunk[n++] = (char *)diff->modified[i];
        }
    }

    cberg_status st = repo_apply_path_changes(r, rechunk, rechunk_n, (char **)diff->deleted, diff->deleted_len);
    free(rechunk);

    if (st == CBERG_OK) {
        fprintf(stderr, "cberg-index[%s]: warm restart: %zu added, %zu modified, %zu deleted since last run\n", r->key, diff->added_len, diff->modified_len, diff->deleted_len);
    }
    return st;
}

/* Diff the saved tree against a fresh rebuild (stat-only for unchanged
 * files) and re-chunk only what changed. On success *out_current is the
 * fresh tree, owned by the caller. */
static cberg_status sync_since(cberg_repo *r, const cberg_manifest *saved, cberg_manifest **out_current) {
    cberg_manifest *current = NULL;
    cberg_status st = cberg_manifest_rebuild_ex(saved, r->root, &r->exclusions, &current);
    if (st != CBERG_OK) {
        return st;
    }

    cberg_manifest_changes diff = {0};
    st = cberg_manifest_diff(saved, current, &diff);
    if (st == CBERG_OK) {
        st = apply_manifest_diff(r, &diff);
        cberg_manifest_diff_free(&diff);
    }

    if (st != CBERG_OK) {
        cberg_manifest_free(current);
        return st;
    }

    *out_current = current;
    return CBERG_OK;
}

/* Reuse the persisted chunk table so unchanged chunks keep their ids (and
 * embeddings). CBERG_ERR_NOT_FOUND means there is no prior state. */
static cberg_status bootstrap_warm(cberg_repo *r) {
    cberg_chunk_table *restored = NULL;
    cberg_status st = cberg_chunk_table_load(r->chunks_path, &restored);
    if (st != CBERG_OK) {
        return st;
    }
    cberg_chunk_table_free(r->table);
    r->table = restored;

    int graph_restored = restore_graph(r);

    /* Chunk table but no manifest baseline: we still avoid re-embedding (ids
     * were restored), but must walk + re-chunk every file to learn what
     * changed. Re-parsing every file rebuilds the graph as a side effect. */
    cberg_manifest *saved = load_manifest(r);
    if (saved == NULL) {
        st = walk_and_sync(r);
        if (st == CBERG_OK) {
            repo_save_state(r);
        }
        return st;
    }

    cberg_manifest *current = NULL;
    st = sync_since(r, saved, &current);
    cberg_manifest_free(saved);
    if (st != CBERG_OK) {
        return st;
    }

    cberg_manifest_free(r->manifest);
    r->manifest = current; /* the fresh tree becomes the new baseline */

    if (graph_restored) {
        repo_resolve_imports(r);
    } else {
        rebuild_graph(r); /* the diff only re-parsed changed files; cover the rest */
    }

    repo_save_state(r);
    return CBERG_OK;
}

/* Warm when prior state is on disk, cold otherwise. */
static cberg_status bootstrap_locked(cberg_repo *r) {
    if (r->chunks_path != NULL) {
        cberg_status st = bootstrap_warm(r);
        if (st != CBERG_ERR_NOT_FOUND) {
            return st;
        }
    }

    cberg_status st = walk_and_sync(r);
    if (st == CBERG_OK) {
        repo_save_state(r);
    }
    return st;
}

cberg_status cberg_repo_bootstrap(cberg_repo *r) {
    pthread_mutex_lock(&r->mu);
    atomic_store(&r->progress_active, 1);
    repo_progress_begin(r, "counting", 0, 0);

    cberg_status st = bootstrap_locked(r);
    if (st == CBERG_OK) {
        r->ready = 1;
    }

    repo_publish_status(r);
    atomic_store(&r->progress_active, 0);
    pthread_mutex_unlock(&r->mu);
    return st;
}
