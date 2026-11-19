#include "indexer_internal.h"

#include "../../src/graph/import_cache.h"

#include <stdio.h>

void repo_progress_begin(cberg_repo *r, const char *phase, size_t total, size_t completed) {
    atomic_store(&r->progress_total, 0);
    atomic_store(&r->progress_completed, completed);
    atomic_store(&r->progress_phase, phase);
    atomic_store(&r->progress_total, total);
}

void repo_save_chunk_table(cberg_repo *r) {
    if (r->chunks_path == NULL) {
        return;
    }
    cberg_status st = cberg_chunk_table_save(r->table, r->chunks_path);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index[%s]: warning: could not persist chunk table: %s\n", r->key, cberg_status_str(st));
    }
}

static void save_manifest(cberg_repo *r) {
    if (r->manifest_path == NULL || r->manifest == NULL) {
        return;
    }
    cberg_status st = cberg_manifest_save(r->manifest, r->manifest_path);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index[%s]: warning: could not persist manifest: %s\n", r->key, cberg_status_str(st));
    }
}

void repo_save_graph(cberg_repo *r) {
    if (r->graph_path == NULL || r->graph == NULL) {
        return;
    }
    cberg_status st = cberg_graph_save(r->graph, r->graph_path);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index[%s]: warning: could not persist graph: %s\n", r->key, cberg_status_str(st));
    }
}

void repo_save_state(cberg_repo *r) {
    repo_save_chunk_table(r);
    save_manifest(r);
    repo_save_graph(r);
}

/* Phase 2: rewrite IMPORTS that resolve via package manifests. Best-effort. */
void repo_resolve_imports(cberg_repo *r) {
    if (r->graph == NULL || r->root == NULL) {
        return;
    }
    cberg_status st = cberg_graph_resolve_cached_ex(r->graph, r->root, &r->exclusions, &r->import_cache);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index[%s]: warning: import resolution failed: %s\n", r->key, cberg_status_str(st));
    }
}

/* Rebuild the manifest baseline from the current on-disk tree (stat-only for
 * unchanged files) so the next restart sees an accurate "what changed while we
 * were down". Failure is non-fatal: the baseline simply stays as it was. */
void repo_refresh_manifest(cberg_repo *r) {
    if (r->manifest_path == NULL) {
        return;
    }
    cberg_manifest *next = NULL;
    cberg_status st = cberg_manifest_rebuild_ex(r->manifest, r->root, &r->exclusions, &next);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index[%s]: warning: could not refresh manifest: %s\n", r->key, cberg_status_str(st));
        return;
    }
    cberg_manifest_free(r->manifest);
    r->manifest = next;
}

/* Health reports the last committed readiness while embedding is in flight. */
void repo_publish_status(cberg_repo *r) {
    atomic_store(&r->published_chunks, cberg_chunk_table_len(r->table));
    atomic_store(&r->published_ready, r->ready);
    if (r->ready) {
        repo_progress_begin(r, "complete", cberg_chunk_table_len(r->table), cberg_chunk_table_len(r->table));
    }
}
