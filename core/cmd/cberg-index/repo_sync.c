#define _POSIX_C_SOURCE 200809L

#include "indexer_internal.h"

#include "../../src/graph/import_cache.h"
#include "chunk_table_internal.h"
#include "fileio.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

cberg_status repo_graph_key_resolver(void *ctx, const char *key, uint64_t *out_id) {
    const cberg_stored_chunk *sc = cberg_chunk_table_find_by_key(ctx, key);
    if (sc == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    *out_id = sc->id;
    return CBERG_OK;
}

/* Patch the graph with the batch's fragments. Runs right after the chunk-table
 * sync so fragment defs resolve to fresh chunk ids; failures degrade the graph
 * (a file's structure goes missing until its next change) but never fail the
 * chunk/vector pipeline. Caller holds r->mu. */
static void apply_graph_fragments(cberg_repo *r, chunk_batch *batch) {
    if (r->graph == NULL) {
        return;
    }
    repo_progress_begin(r, "graph", batch->frags_len, 0);
    for (size_t i = 0; i < batch->frags_len; i++) {
        cberg_status st = cberg_graph_apply(r->graph, batch->frags[i], repo_graph_key_resolver, r->table);
        if (st != CBERG_OK) {
            fprintf(stderr, "cberg-index[%s]: warning: graph update failed for '%s': %s\n", r->key, cberg_graph_fragment_path(batch->frags[i]), cberg_status_str(st));
        }
        atomic_store(&r->progress_completed, i + 1);
    }
}

/* Commit chunk table + graph fragments. On success the dual-index text side is
 * consistent; callers that also drop graph paths (deletes / empty rechunks)
 * should do so before repo_sync_vectors so a later vector failure cannot leave
 * stale graph nodes for paths already removed from the table. */
cberg_status repo_sync_chunks(cberg_repo *r, chunk_batch *batch, cberg_changes *out_ch) {
    cberg_changes ch = {0};
    cberg_status st = cberg_chunk_table_sync(r->table, batch->items, batch->len, &ch);
    if (st != CBERG_OK) {
        return st;
    }
    apply_graph_fragments(r, batch);
    atomic_store(&r->published_chunks, cberg_chunk_table_len(r->table));
    if (out_ch != NULL) {
        *out_ch = ch;
    }
    return CBERG_OK;
}

cberg_status repo_sync_table(cberg_repo *r, chunk_batch *batch) {
    cberg_changes ch = {0};
    cberg_status st = repo_sync_chunks(r, batch, &ch);
    if (st != CBERG_OK) {
        return st;
    }

    /* The table and graph hold their own copies now; free the per-file lists
     * and fragments before embedding instead of carrying them through it. */
    chunk_batch_reset(batch);
    return repo_sync_vectors(r, &ch);
}

/* One bad file must not cost the project its index: say which file was left
 * out and why, then carry on. Capped so a tree of them cannot flood the log. */
static void warn_skipped(cberg_repo *r, const char *rel, const char *reason) {
    static atomic_size_t skipped;
    size_t n = atomic_fetch_add(&skipped, 1) + 1;

    if (n <= 20 || n % 1000 == 0) {
        fprintf(stderr, "cberg-index[%s]: warning: skipped '%s': %s (%zu skipped so far)\n", r->key, rel, reason, n);
    }
}

/* Chunk (and, when the repo has a graph, extract) one file. out_frag may be
 * NULL to skip extraction; a NULL *out_frag with OK means the file carries no
 * graph structure (markdown, config, unknown language, or unreadable).
 *
 * Only running out of memory is an error. A file that cannot be read or
 * parsed is skipped with a warning and reported like an empty one. */
cberg_status repo_parse_file(cberg_repo *r, const char *abs, const char *rel, cberg_chunk_list **out, cberg_graph_fragment **out_frag) {
    *out = NULL;
    if (out_frag != NULL) {
        *out_frag = NULL;
    }

    /* Decide by name first: binaries and assets are never read into memory. */
    cberg_language lang = cberg_language_from_path(rel);
    if (lang == CBERG_LANG_UNKNOWN) {
        return CBERG_OK;
    }

    /* Generated parsers, bundles and data dumps dwarf hand-written code and
     * would dominate both indexing time and search results. */
    struct stat info;
    uint64_t limit = r->eng->max_file_bytes;
    if (limit > 0 && stat(abs, &info) == 0 && (uint64_t)info.st_size > limit) {
        warn_skipped(r, rel, "larger than CBERG_MAX_FILE_BYTES");
        return CBERG_OK;
    }

    size_t len = 0;
    errno = 0;
    char *data = cberg_read_file(abs, &len);
    if (data == NULL) {
        if (errno == ENOMEM) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        if (errno != ENOENT) {
            warn_skipped(r, rel, errno != 0 ? strerror(errno) : "unreadable");
        }
        return CBERG_OK;
    }

    cberg_chunk_list *list = NULL;
    cberg_status st = cberg_chunker_analyze(r->eng->chunker, lang, rel, data, len, &list, r->graph != NULL ? out_frag : NULL);
    if (st == CBERG_OK && list != NULL) {
        st = cberg_chunk_list_hash_bodies(list, data, len);
    }
    free(data);

    if (st == CBERG_OK) {
        *out = list;
        return CBERG_OK;
    }

    if (out_frag != NULL) {
        cberg_graph_fragment_free(*out_frag);
        *out_frag = NULL;
    }
    cberg_chunk_list_free(list);

    if (st == CBERG_ERR_OUT_OF_MEMORY) {
        return st;
    }

    warn_skipped(r, rel, cberg_status_str(st));
    return CBERG_OK;
}

static cberg_status graph_drop_push(char ***list, size_t *len, size_t *cap, char *path) {
    if (*len + 1 > *cap) {
        size_t new_cap = *cap == 0 ? 8 : *cap * 2;
        char **next = realloc(*list, new_cap * sizeof(**list));
        if (next == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        *list = next;
        *cap = new_cap;
    }
    (*list)[(*len)++] = path;
    return CBERG_OK;
}

/* Re-index a set of changed paths: carry over every chunk except those of
 * `rechunk`+`deleted`, re-chunk `rechunk` from disk, and sync the union — so only
 * the affected files are parsed and only chunks whose content moved get
 * re-embedded. The path arrays are borrowed (not freed). Caller holds r->mu.
 *
 * Graph drops for deleted / empty-rechunk paths run after repo_sync_chunks (table +
 * fragment apply) and before repo_sync_vectors, so a vector failure cannot leave
 * stale graph nodes for paths already removed from the chunk table, and a
 * failed parse/repo_sync_chunks cannot drop graph state ahead of the table. */
cberg_status repo_apply_path_changes(cberg_repo *r, char **rechunk, size_t rechunk_n, char **deleted, size_t deleted_n) {
    for (size_t i = 0; i < rechunk_n; i++) {
        cberg_import_cache_note(&r->import_cache, rechunk[i], 0);
    }
    for (size_t i = 0; i < deleted_n; i++) {
        cberg_import_cache_note(&r->import_cache, deleted[i], 1);
    }

    chunk_batch batch;
    chunk_batch_init(&batch);

    char **skip = NULL;
    size_t skip_n = 0;
    /* Paths whose graph nodes must be dropped after repo_sync_chunks succeeds. */
    char **graph_drop = NULL;
    size_t graph_drop_n = 0;
    size_t graph_drop_cap = 0;
    if (rechunk_n + deleted_n > 0) {
        skip = calloc(rechunk_n + deleted_n, sizeof(*skip));
        if (skip == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        for (size_t i = 0; i < deleted_n; i++) {
            skip[skip_n++] = deleted[i];
        }
        for (size_t i = 0; i < rechunk_n; i++) {
            skip[skip_n++] = rechunk[i];
        }
    }

    cberg_status st = chunk_batch_add_table_except(r, &batch, skip, skip_n);
    if (st != CBERG_OK) {
        goto done;
    }

    for (size_t i = 0; i < rechunk_n; i++) {
        char abs[4096];
        snprintf(abs, sizeof(abs), "%s/%s", r->root, rechunk[i]);
        cberg_chunk_list *list = NULL;
        cberg_graph_fragment *frag = NULL;
        st = repo_parse_file(r, abs, rechunk[i], &list, &frag);
        if (st != CBERG_OK) {
            goto done;
        }
        if (list != NULL) {
            st = chunk_batch_add_list(&batch, list);
            if (st != CBERG_OK) {
                cberg_chunk_list_free(list);
                cberg_graph_fragment_free(frag);
                goto done;
            }
            st = chunk_batch_add_fragment(&batch, frag);
            if (st != CBERG_OK) {
                cberg_graph_fragment_free(frag);
                goto done;
            }
        } else {
            /* Emptied / unreadable-as-chunks: drop graph after table commit. */
            cberg_graph_fragment_free(frag);
            st = graph_drop_push(&graph_drop, &graph_drop_n, &graph_drop_cap, rechunk[i]);
            if (st != CBERG_OK) {
                goto done;
            }
        }
    }

    for (size_t i = 0; i < deleted_n; i++) {
        st = graph_drop_push(&graph_drop, &graph_drop_n, &graph_drop_cap, deleted[i]);
        if (st != CBERG_OK) {
            goto done;
        }
    }

    cberg_changes ch = {0};
    st = repo_sync_chunks(r, &batch, &ch);
    if (st != CBERG_OK) {
        goto done;
    }
    if (r->graph != NULL) {
        for (size_t i = 0; i < graph_drop_n; i++) {
            cberg_graph_remove_file(r->graph, graph_drop[i]);
        }
    }
    chunk_batch_reset(&batch);
    st = repo_sync_vectors(r, &ch);

done:
    chunk_batch_reset(&batch);
    free(skip);
    free(graph_drop);
    return st;
}
