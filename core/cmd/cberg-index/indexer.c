#define _POSIX_C_SOURCE 200809L

#include "indexer.h"

#include "fileio.h"
#include "pathutil.h"
#include "u64map.h"

#include <errno.h>
#include <fnmatch.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define BATCH_SIZE 32
#define PROGRESS_MIN 128  /* only show embed progress for upserts at least this large */
#define PROGRESS_STEP 512 /* ...and roughly every this many chunks */

static void save_chunk_table(cberg_repo *r);
static void save_state(cberg_repo *r);
static void refresh_manifest(cberg_repo *r);
static cberg_status apply_path_changes(cberg_repo *r, char **rechunk, size_t rechunk_n, char **deleted, size_t deleted_n);
static cberg_status walk_and_sync(cberg_repo *r);
static cberg_status bootstrap_warm(cberg_repo *r);

/* The single choke point for the shared embedder: the ONNX session is not
 * thread-safe, and both the indexing (main) thread and the IPC search thread
 * embed. Callers must NOT hold embed_mu already; holding a repo->mu is fine
 * (lock order repo->mu -> embed_mu). */
static cberg_status engine_embed(cberg_engine *eng, const char *const *texts, const size_t *lens, size_t count, float **out_vectors) {
    pthread_mutex_lock(&eng->embed_mu);
    cberg_status st = cberg_embedder_embed(eng->embedder, texts, lens, count, out_vectors);
    pthread_mutex_unlock(&eng->embed_mu);
    return st;
}

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

static int batch_init(chunk_batch *b) {
    memset(b, 0, sizeof(*b));
    return 0;
}

static void batch_clear_lists(chunk_batch *b) {
    for (size_t i = 0; i < b->lists_len; i++) {
        cberg_chunk_list_free(b->lists[i]);
    }
    free(b->lists);
    b->lists = NULL;
    b->lists_len = 0;
    b->lists_cap = 0;
}

static void batch_reset(chunk_batch *b) {
    free(b->items);
    b->items = NULL;
    b->len = 0;
    b->cap = 0;
    batch_clear_lists(b);
    for (size_t i = 0; i < b->frags_len; i++) {
        cberg_graph_fragment_free(b->frags[i]);
    }
    free(b->frags);
    b->frags = NULL;
    b->frags_len = 0;
    b->frags_cap = 0;
}

static cberg_status batch_add_fragment(chunk_batch *b, cberg_graph_fragment *frag) {
    if (frag == NULL) {
        return CBERG_OK;
    }
    if (b->frags_len + 1 > b->frags_cap) {
        size_t new_cap = b->frags_cap == 0 ? 16 : b->frags_cap * 2;
        cberg_graph_fragment **next = realloc(b->frags, new_cap * sizeof(*b->frags));
        if (next == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        b->frags = next;
        b->frags_cap = new_cap;
    }
    b->frags[b->frags_len++] = frag;
    return CBERG_OK;
}

static cberg_status batch_add_list(chunk_batch *b, cberg_chunk_list *list) {
    if (list == NULL) {
        return CBERG_OK;
    }
    size_t n = cberg_chunk_list_len(list);
    if (b->len + n > b->cap) {
        size_t new_cap = b->cap == 0 ? 64 : b->cap * 2;
        while (new_cap < b->len + n) {
            new_cap *= 2;
        }
        cberg_chunk *next = realloc(b->items, new_cap * sizeof(cberg_chunk));
        if (next == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        b->items = next;
        b->cap = new_cap;
    }
    for (size_t i = 0; i < n; i++) {
        b->items[b->len++] = *cberg_chunk_list_at(list, i);
    }
    if (b->lists_len + 1 > b->lists_cap) {
        size_t new_cap = b->lists_cap == 0 ? 16 : b->lists_cap * 2;
        cberg_chunk_list **next = realloc(b->lists, new_cap * sizeof(*b->lists));
        if (next == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        b->lists = next;
        b->lists_cap = new_cap;
    }
    b->lists[b->lists_len++] = list;
    return CBERG_OK;
}

static int path_in_set(const char *path, char **paths, size_t count) {
    for (size_t i = 0; i < count; i++) {
        if (strcmp(path, paths[i]) == 0) {
            return 1;
        }
    }
    return 0;
}

static char *chunk_body(const cberg_repo *r, const cberg_stored_chunk *sc, size_t *out_len) {
    char path[4096];
    snprintf(path, sizeof(path), "%s/%s", r->root, sc->chunk.path);
    return cberg_read_file(path, out_len);
}

/*
 * Per-run cache of file bodies for the embed pass. Reading a chunk's whole file
 * from disk for every chunk meant a file with M chunks was read M times; chunks
 * of one file arrive contiguously (chunk lists are appended per file), so a body
 * is reused while consecutive chunks share its path and re-read only when the
 * path changes. A non-contiguous repeat simply reads the file again — still
 * correct, just not deduped. Buffers stay live until file_cache_free because the
 * embed pass slices directly into them.
 */
typedef struct {
    const char *path; /* borrowed from the stored chunk; identifies the buffer */
    char *data;       /* owned file body */
    size_t len;
} cached_body;

typedef struct {
    cached_body *items;
    size_t len;
    size_t cap;
} file_cache;

static void file_cache_free(file_cache *fc) {
    for (size_t i = 0; i < fc->len; i++) {
        free(fc->items[i].data);
    }
    free(fc->items);
    fc->items = NULL;
    fc->len = 0;
    fc->cap = 0;
}

/* Resolve sc's chunk to a [text, len) slice of its file body, reading the file
 * only on the first chunk of each contiguous same-file run. The slice points into
 * a cached buffer owned by fc and stays valid until file_cache_free. */
static cberg_status cache_slice(cberg_repo *r, file_cache *fc, const cberg_stored_chunk *sc, const char **text, size_t *len) {
    cached_body *cb = (fc->len > 0 && strcmp(fc->items[fc->len - 1].path, sc->chunk.path) == 0)
                          ? &fc->items[fc->len - 1]
                          : NULL;
    if (cb == NULL) {
        if (fc->len + 1 > fc->cap) {
            size_t cap = fc->cap == 0 ? 16 : fc->cap * 2;
            cached_body *grown = realloc(fc->items, cap * sizeof(*grown));
            if (grown == NULL) {
                return CBERG_ERR_OUT_OF_MEMORY;
            }
            fc->items = grown;
            fc->cap = cap;
        }
        size_t blen = 0;
        char *data = chunk_body(r, sc, &blen);
        if (data == NULL) {
            return CBERG_ERR_IO;
        }
        cb = &fc->items[fc->len++];
        cb->path = sc->chunk.path;
        cb->data = data;
        cb->len = blen;
    }
    uint32_t start = sc->chunk.span.start_byte;
    uint32_t end = sc->chunk.span.end_byte;
    if (end > cb->len || start > end) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *text = cb->data + start;
    *len = (size_t)(end - start);
    return CBERG_OK;
}

/*
 * Embed `count` chunks into `index`, embedding only one representative per distinct
 * body. Chunks that share a content_hash (byte-identical text — license headers,
 * generated code, trivial accessors, vendored copies) are embedded once and that
 * vector is reused for every chunk with the same body; the model is deterministic,
 * so this is identical to embedding each separately, just without the repeat compute.
 *
 * Bodies pair only on a full CBERG_HASH_LEN match (the map keys on the first 8 bytes
 * for speed, then confirms), so a 64-bit bucket collision can never share a wrong
 * vector. Duplicates are grouped behind their representative so embedding still runs
 * in BATCH_SIZE windows whose vectors are freed before the next — peak extra memory
 * stays one batch, not the whole upsert.
 *
 * When `show`, prints embed progress against `total` as chunks are indexed, advancing
 * *done. *out_unique (nullable) receives the count of bodies actually embedded.
 *
 * The embed lock is taken per batch (inside engine_embed), not around the whole
 * upsert, so a concurrent search query waits at most one batch.
 */
static cberg_status embed_unique(cberg_repo *r, cberg_index *index, const char **texts, const size_t *lens, const uint8_t **hashes, const uint64_t *ids, size_t count, int show, size_t *done, size_t total, size_t *out_unique) {
    if (out_unique != NULL) {
        *out_unique = 0;
    }
    if (count == 0) {
        return CBERG_OK;
    }
    size_t dim = cberg_embedder_dim(r->eng->embedder);

    cberg_u64map *seen = cberg_u64map_new(count * 2);
    size_t *reps = malloc(count * sizeof(*reps));         /* group -> a representative item index */
    size_t *group_of = malloc(count * sizeof(*group_of)); /* item -> its group index */
    const char **btexts = malloc(BATCH_SIZE * sizeof(*btexts));
    size_t *blens = malloc(BATCH_SIZE * sizeof(*blens));
    size_t *group_start = NULL;
    size_t *members = NULL;
    size_t *cursor = NULL;
    cberg_status st = CBERG_ERR_OUT_OF_MEMORY;
    if (seen == NULL || reps == NULL || group_of == NULL || btexts == NULL || blens == NULL) {
        goto done;
    }

    /* Pass 1: assign each item to a group keyed by its body. A 64-bit hash-prefix hit
     * is confirmed against the full hash; a mismatch (collision) or an all-zero prefix
     * (the map reserves key 0) just starts its own group. The map records only the
     * first group for a prefix, so a collision leaves the original mapping intact. */
    size_t n_groups = 0;
    for (size_t u = 0; u < count; u++) {
        uint64_t key;
        memcpy(&key, hashes[u], sizeof(key));
        uint64_t hit = 0;
        int found = key != 0 && cberg_u64map_get(seen, key, &hit);
        if (found && memcmp(hashes[u], hashes[reps[hit]], CBERG_HASH_LEN) == 0) {
            group_of[u] = (size_t)hit;
            continue;
        }
        if (key != 0 && !found) {
            st = cberg_u64map_set(seen, key, n_groups);
            if (st != CBERG_OK) {
                goto done;
            }
        }
        reps[n_groups] = u;
        group_of[u] = n_groups;
        n_groups++;
    }

    /* Pass 2: CSR-group the items so a representative and all its duplicates are
     * contiguous in `members`, letting each embed batch be freed before the next. */
    group_start = calloc(n_groups + 1, sizeof(*group_start));
    members = malloc(count * sizeof(*members));
    cursor = malloc(n_groups * sizeof(*cursor));
    if (group_start == NULL || members == NULL || cursor == NULL) {
        st = CBERG_ERR_OUT_OF_MEMORY;
        goto done;
    }
    for (size_t u = 0; u < count; u++) {
        group_start[group_of[u] + 1]++;
    }
    for (size_t k = 0; k < n_groups; k++) {
        group_start[k + 1] += group_start[k];
        cursor[k] = group_start[k];
    }
    for (size_t u = 0; u < count; u++) {
        members[cursor[group_of[u]]++] = u;
    }

    size_t mark = (*done / PROGRESS_STEP + 1) * PROGRESS_STEP;
    st = CBERG_OK;
    for (size_t g = 0; g < n_groups;) {
        size_t bn = n_groups - g;
        if (bn > BATCH_SIZE) {
            bn = BATCH_SIZE;
        }
        for (size_t b = 0; b < bn; b++) {
            btexts[b] = texts[reps[g + b]];
            blens[b] = lens[reps[g + b]];
        }
        float *vecs = NULL;
        st = engine_embed(r->eng, btexts, blens, bn, &vecs);
        if (st != CBERG_OK) {
            cberg_vectors_free(vecs);
            goto done;
        }
        for (size_t b = 0; b < bn; b++) {
            size_t k = g + b;
            const float *v = vecs + b * dim;
            for (size_t m = group_start[k]; m < group_start[k + 1]; m++) {
                st = cberg_index_add(index, ids[members[m]], v);
                if (st != CBERG_OK) {
                    cberg_vectors_free(vecs);
                    goto done;
                }
                (*done)++;
                if (show && (*done >= mark || *done == total)) {
                    fprintf(stderr, "cberg-index[%s]: embedded %zu/%zu chunks (%zu%%)\n", r->key, *done, total, *done * 100 / total);
                    mark += PROGRESS_STEP;
                }
            }
        }
        cberg_vectors_free(vecs);
        g += bn;
    }
    if (out_unique != NULL) {
        *out_unique = n_groups;
    }

done:
    cberg_u64map_free(seen);
    free(reps);
    free(group_of);
    free(group_start);
    free(members);
    free(cursor);
    free(btexts);
    free(blens);
    return st;
}

static cberg_status apply_vectors(cberg_repo *r, const cberg_changes *ch) {
    if (!r->eng->vectors || r->eng->embedder == NULL || r->index == NULL) {
        return CBERG_OK;
    }

    size_t upsert_len = ch->added_len + ch->modified_len;
    if (upsert_len == 0 && ch->deleted_len == 0) {
        return cberg_index_save(r->index);
    }

    const char **texts = NULL;
    size_t *lens = NULL;
    uint64_t *ids = NULL;
    const uint8_t **hashes = NULL;
    file_cache fc = {0};
    cberg_status st = CBERG_OK;

    if (upsert_len > 0) {
        texts = calloc(upsert_len, sizeof(*texts));
        lens = calloc(upsert_len, sizeof(*lens));
        ids = calloc(upsert_len, sizeof(*ids));
        hashes = calloc(upsert_len, sizeof(*hashes));
        if (texts == NULL || lens == NULL || ids == NULL || hashes == NULL) {
            st = CBERG_ERR_OUT_OF_MEMORY;
            goto done;
        }
        size_t u = 0;
        for (size_t i = 0; i < ch->added_len; i++) {
            st = cache_slice(r, &fc, &ch->added[i], &texts[u], &lens[u]);
            if (st != CBERG_OK) {
                goto done;
            }
            ids[u] = ch->added[i].id;
            hashes[u] = ch->added[i].chunk.content_hash;
            u++;
        }
        for (size_t i = 0; i < ch->modified_len; i++) {
            st = cache_slice(r, &fc, &ch->modified[i], &texts[u], &lens[u]);
            if (st != CBERG_OK) {
                goto done;
            }
            ids[u] = ch->modified[i].id;
            hashes[u] = ch->modified[i].chunk.content_hash;
            u++;
        }

        /* Embed unique bodies only: code upserts carry many byte-identical chunks
         * (license headers, generated code, trivial accessors), and identical text
         * maps to an identical vector, so embedding one and reusing it is exact. */
        int show = upsert_len >= PROGRESS_MIN;
        size_t done_n = 0;
        size_t unique = 0;
        st = embed_unique(r, r->index, texts, lens, hashes, ids, upsert_len, show, &done_n, upsert_len, &unique);
        if (st != CBERG_OK) {
            goto done;
        }
        if (show && unique < upsert_len) {
            fprintf(stderr, "cberg-index[%s]: reused %zu duplicate bodies (embedded %zu unique of %zu chunks)\n", r->key, upsert_len - unique, unique, upsert_len);
        }
    }

    int del_show = ch->deleted_len >= PROGRESS_MIN;
    size_t del_mark = PROGRESS_STEP;
    for (size_t i = 0; i < ch->deleted_len; i++) {
        st = cberg_index_remove(r->index, ch->deleted[i].id);
        if (st == CBERG_ERR_NOT_FOUND) {
            /* Already absent — e.g. a kill let the index save outrun the chunk-table
             * save, so on restart the table still lists an id the index dropped. The
             * desired post-state (id gone) already holds, so treat it as done instead
             * of escalating to a full index rebuild. In steady state every table id has
             * an index entry, so this only fires while recovering that divergence. */
            st = CBERG_OK;
        }
        if (st != CBERG_OK) {
            goto done;
        }
        if (del_show && (i + 1 >= del_mark || i + 1 == ch->deleted_len)) {
            fprintf(stderr, "cberg-index[%s]: removed %zu/%zu chunks (%zu%%)\n", r->key, i + 1, ch->deleted_len, (i + 1) * 100 / ch->deleted_len);
            del_mark += PROGRESS_STEP;
        }
    }

    st = cberg_index_save(r->index);

done:
    file_cache_free(&fc);
    free(hashes);
    free(ids);
    free(lens);
    free(texts);
    return st;
}

static cberg_status rebuild_index(cberg_repo *r);

static int vector_status_retriable(cberg_status st) {
    return st == CBERG_ERR_IO || st == CBERG_ERR_TIMEOUT || st == CBERG_ERR_INTERNAL;
}

static void vector_retry_backoff(int attempt) {
    usleep((useconds_t)(100000u * (unsigned)(attempt + 1)));
}

typedef cberg_status (*vector_retry_fn)(cberg_repo *r, void *ctx);

static cberg_status with_vector_retry(cberg_repo *r, const char *op_name, vector_retry_fn fn, void *ctx) {
    cberg_status st = fn(r, ctx);
    for (int attempt = 0; st != CBERG_OK && vector_status_retriable(st) && attempt < 3; attempt++) {
        fprintf(stderr, "cberg-index[%s]: %s failed (%s); retry %d/3\n", r->key, op_name, cberg_status_str(st), attempt + 1);
        vector_retry_backoff(attempt);
        st = fn(r, ctx);
    }
    return st;
}

static cberg_status apply_vectors_op(cberg_repo *r, void *ctx) {
    return apply_vectors(r, ctx);
}

static cberg_status rebuild_index_op(cberg_repo *r, void *ctx) {
    (void)ctx;
    return rebuild_index(r);
}

static cberg_status rebuild_index(cberg_repo *r) {
    if (!r->eng->vectors || r->eng->embedder == NULL || r->index == NULL) {
        return CBERG_OK;
    }

    size_t dim = cberg_embedder_dim(r->eng->embedder);
    const cberg_index_config *cfg = &r->eng->index_cfg;
    cberg_index *target = r->index;
    cberg_index *temp_idx = NULL;
    char temp[4096] = {0};

    if (cberg_index_provider_rebuild_inplace(cfg->provider)) {
        cberg_status st = cberg_index_clear(r->index);
        if (st != CBERG_OK) {
            return st;
        }
    } else {
        snprintf(temp, sizeof(temp), "%s.rebuild", r->index_path);
        unlink(temp);

        cberg_status st = cberg_index_open(temp, dim, cfg, &temp_idx);
        if (st != CBERG_OK) {
            return st;
        }
        target = temp_idx;
    }

    size_t n = cberg_chunk_table_len(r->table);
    for (size_t i = 0; i < n;) {
        size_t end = i + BATCH_SIZE;
        if (end > n) {
            end = n;
        }
        size_t batch_n = end - i;
        const char **texts = calloc(batch_n, sizeof(*texts));
        size_t *lens = calloc(batch_n, sizeof(*lens));
        uint64_t *ids = calloc(batch_n, sizeof(*ids));
        file_cache fc = {0};
        size_t count = 0;
        cberg_status st;
        if (texts == NULL || lens == NULL || ids == NULL) {
            st = CBERG_ERR_OUT_OF_MEMORY;
            free(texts);
            free(lens);
            free(ids);
            if (temp_idx != NULL) {
                cberg_index_close(temp_idx);
                if (temp[0] != '\0') {
                    unlink(temp);
                }
            }
            return st;
        }
        for (size_t j = i; j < end; j++) {
            const cberg_stored_chunk *sc = cberg_chunk_table_at(r->table, j);
            if (sc == NULL) {
                continue;
            }
            st = cache_slice(r, &fc, sc, &texts[count], &lens[count]);
            if (st != CBERG_OK) {
                file_cache_free(&fc);
                free(texts);
                free(lens);
                free(ids);
                if (temp_idx != NULL) {
                    cberg_index_close(temp_idx);
                    unlink(temp);
                }
                return st;
            }
            ids[count] = sc->id;
            count++;
        }
        if (count > 0) {
            float *vecs = NULL;
            st = engine_embed(r->eng, texts, lens, count, &vecs);
            file_cache_free(&fc);
            free(texts);
            free(lens);
            if (st != CBERG_OK) {
                free(ids);
                if (temp_idx != NULL) {
                    cberg_index_close(temp_idx);
                    unlink(temp);
                }
                return st;
            }
            for (size_t k = 0; k < count; k++) {
                st = cberg_index_add(target, ids[k], vecs + k * dim);
                if (st != CBERG_OK) {
                    cberg_vectors_free(vecs);
                    free(ids);
                    if (temp_idx != NULL) {
                        cberg_index_close(temp_idx);
                        unlink(temp);
                    }
                    return st;
                }
            }
            cberg_vectors_free(vecs);
            free(ids);
        } else {
            file_cache_free(&fc);
            free(texts);
            free(lens);
            free(ids);
        }
        i = end;
    }

    if (cberg_index_provider_rebuild_inplace(cfg->provider)) {
        return cberg_index_save(r->index);
    }

    cberg_status st = cberg_index_save(temp_idx);
    cberg_index_close(temp_idx);
    if (st != CBERG_OK) {
        unlink(temp);
        return st;
    }

    cberg_index_close(r->index);
    r->index = NULL;
    if (rename(temp, r->index_path) != 0) {
        st = CBERG_ERR_IO;
        cberg_index_open(r->index_path, dim, cfg, &r->index);
        return st;
    }
    return cberg_index_open(r->index_path, dim, cfg, &r->index);
}

static cberg_status graph_key_resolver(void *ctx, const char *key, uint64_t *out_id) {
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
    for (size_t i = 0; i < batch->frags_len; i++) {
        cberg_status st = cberg_graph_apply(r->graph, batch->frags[i], graph_key_resolver, r->table);
        if (st != CBERG_OK) {
            fprintf(stderr, "cberg-index[%s]: warning: graph update failed for '%s': %s\n", r->key, cberg_graph_fragment_path(batch->frags[i]), cberg_status_str(st));
        }
    }
}

static cberg_status sync_table(cberg_repo *r, chunk_batch *batch) {
    cberg_changes ch = {0};
    cberg_status st = cberg_chunk_table_sync(r->table, batch->items, batch->len, &ch);
    if (st != CBERG_OK) {
        return st;
    }
    apply_graph_fragments(r, batch);
    st = with_vector_retry(r, "vector apply", apply_vectors_op, &ch);
    if (st != CBERG_OK) {
        r->ready = 0;
        if (vector_status_retriable(st)) {
            fprintf(stderr, "cberg-index[%s]: vector apply still failing after retries (%s); rebuilding index\n", r->key, cberg_status_str(st));
        }
        cberg_status rb = with_vector_retry(r, "index rebuild", rebuild_index_op, NULL);
        if (rb != CBERG_OK) {
            return rb;
        }
        r->ready = 1;
    }
    /* Live per-sync line for the watch loop; bootstrap reports via embed progress
     * and the final "bootstrap complete" count instead. */
    if (r->ready && (ch.added_len != 0 || ch.modified_len != 0 || ch.deleted_len != 0)) {
        fprintf(stderr, "cberg-index[%s]: indexed +%zu ~%zu -%zu (%zu chunks)\n", r->key, ch.added_len, ch.modified_len, ch.deleted_len, cberg_chunk_table_len(r->table));
    }
    return CBERG_OK;
}

/* Chunk (and, when the repo has a graph, extract) one file. out_frag may be
 * NULL to skip extraction; a NULL *out_frag with OK means the file carries no
 * graph structure (markdown, config, unknown language, or unreadable). */
static cberg_status parse_file(cberg_repo *r, const char *abs, const char *rel, cberg_chunk_list **out, cberg_graph_fragment **out_frag) {
    *out = NULL;
    if (out_frag != NULL) {
        *out_frag = NULL;
    }
    size_t len = 0;
    char *data = cberg_read_file(abs, &len);
    if (data == NULL) {
        return errno == ENOENT ? CBERG_OK : CBERG_ERR_IO;
    }
    cberg_language lang = cberg_language_from_path(rel);
    if (lang == CBERG_LANG_UNKNOWN) {
        free(data);
        return CBERG_OK;
    }
    cberg_chunk_list *list = NULL;
    cberg_status st = cberg_chunker_analyze(r->eng->chunker, lang, rel, data, len, &list, r->graph != NULL ? out_frag : NULL);
    if (st != CBERG_OK) {
        free(data);
        return st;
    }
    if (list != NULL) {
        st = cberg_chunk_list_hash_bodies(list, data, len);
        if (st != CBERG_OK) {
            if (out_frag != NULL) {
                cberg_graph_fragment_free(*out_frag);
                *out_frag = NULL;
            }
            cberg_chunk_list_free(list);
            free(data);
            return st;
        }
    }
    free(data);
    *out = list;
    return CBERG_OK;
}

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
    cberg_chunk_list *list = NULL;
    cberg_graph_fragment *frag = NULL;
    cberg_status st = parse_file(ctx->repo, abs, rel, &list, &frag);
    if (st != CBERG_OK) {
        ctx->err = st;
        return -1;
    }
    if (list == NULL) {
        return 0;
    }
    st = batch_add_list(ctx->batch, list);
    if (st != CBERG_OK) {
        cberg_chunk_list_free(list);
        cberg_graph_fragment_free(frag);
        ctx->err = st;
        return -1;
    }
    st = batch_add_fragment(ctx->batch, frag); /* batch owns frag on success */
    if (st != CBERG_OK) {
        cberg_graph_fragment_free(frag);
        ctx->err = st;
        return -1;
    }
    return 0;
}

/* ----------------------------------------------------- state persistence */

static void save_chunk_table(cberg_repo *r) {
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

static void save_graph(cberg_repo *r) {
    if (r->graph_path == NULL || r->graph == NULL) {
        return;
    }
    cberg_status st = cberg_graph_save(r->graph, r->graph_path);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index[%s]: warning: could not persist graph: %s\n", r->key, cberg_status_str(st));
    }
}

static void save_state(cberg_repo *r) {
    save_chunk_table(r);
    save_manifest(r);
    save_graph(r);
}

/* Phase 2: rewrite IMPORTS that resolve via package manifests. Best-effort. */
static void resolve_imports(cberg_repo *r) {
    if (r->graph == NULL || r->root == NULL) {
        return;
    }
    cberg_status st = cberg_graph_resolve_imports(r->graph, r->root);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index[%s]: warning: import resolution failed: %s\n", r->key, cberg_status_str(st));
    }
}

/* Rebuild the manifest baseline from the current on-disk tree (stat-only for
 * unchanged files) so the next restart sees an accurate "what changed while we
 * were down". Failure is non-fatal: the baseline simply stays as it was. */
static void refresh_manifest(cberg_repo *r) {
    if (r->manifest_path == NULL) {
        return;
    }
    cberg_manifest *next = NULL;
    cberg_status st = cberg_manifest_rebuild(r->manifest, r->root, &next);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index[%s]: warning: could not refresh manifest: %s\n", r->key, cberg_status_str(st));
        return;
    }
    cberg_manifest_free(r->manifest);
    r->manifest = next;
}

/* 16-hex-char digest of the resolved root path: a stable per-directory tag, so
 * each indexed tree keeps its own index + sidecars. The realpath is the
 * directory's identity — a reverted directory hashes back to the same tag (its
 * cached state is reused), and a different tree gets a disjoint set of files. */
static void root_suffix(const char *root, char out[17]) {
    static const char hex[] = "0123456789abcdef";
    uint8_t h[CBERG_HASH_LEN];
    if (cberg_hash(root, strlen(root), h) != CBERG_OK) {
        memset(h, 0, sizeof(h));
    }
    for (size_t i = 0; i < 8; i++) {
        out[2 * i] = hex[h[i] >> 4];
        out[2 * i + 1] = hex[h[i] & 0x0F];
    }
    out[16] = '\0';
}

static char *join_str(const char *a, const char *b) {
    size_t la = strlen(a), lb = strlen(b);
    char *s = malloc(la + lb + 1);
    if (s != NULL) {
        memcpy(s, a, la);
        memcpy(s + la, b, lb + 1);
    }
    return s;
}

const char *cberg_indexer_version(void) {
    return cberg_version();
}

size_t cberg_repo_chunk_count(cberg_repo *r) {
    pthread_mutex_lock(&r->mu);
    size_t n = cberg_chunk_table_len(r->table);
    pthread_mutex_unlock(&r->mu);
    return n;
}

int cberg_repo_ready(cberg_repo *r) {
    pthread_mutex_lock(&r->mu);
    int ready = r->ready;
    pthread_mutex_unlock(&r->mu);
    return ready;
}

size_t cberg_engine_chunk_count(cberg_engine *eng) {
    size_t total = 0;
    for (size_t i = 0; i < eng->repos_len; i++) {
        total += cberg_repo_chunk_count(eng->repos[i]);
    }
    return total;
}

/* -------------------------------------------------------- engine lifecycle */

static void repo_close(cberg_repo *r) {
    if (r == NULL) {
        return;
    }
    /* On a clean shutdown after bootstrap, refresh the baseline so the next start
     * re-chunks nothing it doesn't have to. Skipped on early-open failures (not
     * ready) to avoid overwriting good state with a half-built one. */
    if (r->ready) {
        refresh_manifest(r);
        save_state(r);
    }
    if (r->index != NULL) {
        cberg_index_save(r->index);
        cberg_index_close(r->index);
    }
    if (r->watcher != NULL) {
        cberg_watcher_close(r->watcher);
    }
    if (r->manifest != NULL) {
        cberg_manifest_free(r->manifest);
    }
    if (r->table != NULL) {
        cberg_chunk_table_free(r->table);
    }
    cberg_graph_free(r->graph);
    free(r->key);
    free(r->root);
    free(r->index_path);
    free(r->chunks_path);
    free(r->manifest_path);
    free(r->graph_path);
    pthread_mutex_destroy(&r->mu);
    free(r);
}

/* Open one repo under the engine: per-root chunk table, watcher, and (in vector
 * mode) the "<base>.<roothash>" index + sidecars — the exact single-root layout,
 * so existing on-disk indexes stay valid. `root` must already be resolved. */
static cberg_status engine_add_repo(cberg_engine *eng, const char *key, const char *root) {
    for (size_t i = 0; i < eng->repos_len; i++) {
        if (strcmp(eng->repos[i]->root, root) == 0 || strcmp(eng->repos[i]->key, key) == 0) {
            fprintf(stderr, "cberg-index: warning: duplicate root or key '%s' ignored\n", key);
            return CBERG_OK;
        }
    }

    cberg_repo *r = calloc(1, sizeof(*r));
    if (r == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    pthread_mutex_init(&r->mu, NULL);
    r->eng = eng;
    r->key = strdup(key);
    r->root = strdup(root);
    if (r->key == NULL || r->root == NULL) {
        repo_close(r);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    r->table = cberg_chunk_table_new();
    if (r->table == NULL) {
        repo_close(r);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    if (eng->graph_enabled) {
        cberg_status gst = cberg_graph_new(&r->graph);
        if (gst != CBERG_OK) {
            repo_close(r);
            return gst;
        }
    }
    cberg_status st = cberg_watcher_open(r->root, &r->watcher);
    if (st != CBERG_OK) {
        repo_close(r);
        return st;
    }

    /* CBERG_INDEX_PATH is a base path; the actual index and its chunk-table /
     * manifest / graph sidecars are per-directory
     * ("<base>.<roothash>[.chunks|.manifest|.graph]"). Pointing at a different
     * tree never reuses another tree's chunks, and reverting to a prior tree
     * finds its embeddings (and graph) still cached. Sidecars are written even
     * in chunk-only mode when the base path is set, so warm restart can reload
     * the graph without ONNX. */
    if (eng->index_base != NULL) {
        char tag[18]; /* ".<16 hex>" */
        tag[0] = '.';
        root_suffix(r->root, tag + 1);
        r->index_path = join_str(eng->index_base, tag);
        if (r->index_path == NULL) {
            repo_close(r);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        r->chunks_path = join_str(r->index_path, ".chunks");
        r->manifest_path = join_str(r->index_path, ".manifest");
        if (r->chunks_path == NULL || r->manifest_path == NULL) {
            repo_close(r);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        if (r->graph != NULL) {
            r->graph_path = join_str(r->index_path, ".graph");
            if (r->graph_path == NULL) {
                repo_close(r);
                return CBERG_ERR_OUT_OF_MEMORY;
            }
        }
    }

    if (eng->vectors) {
        size_t dim = cberg_embedder_dim(eng->embedder);
        st = cberg_index_open(r->index_path, dim, &eng->index_cfg, &r->index);
        if (st == CBERG_ERR_CORRUPT) {
            /* Corrupt on-disk usearch file or remote collection/table with wrong
             * dimension — wipe vectors and sidecars, then cold-reindex. Transient
             * I/O (DB down, network) returns CBERG_ERR_IO and is not wiped here. */
            fprintf(stderr, "cberg-index[%s]: vector index '%s' is corrupt or incompatible; discarding and reindexing\n", r->key, r->index_path);
            cberg_status wipe_st = cberg_index_wipe(r->index_path, dim, &eng->index_cfg);
            if (wipe_st != CBERG_OK) {
                fprintf(stderr, "cberg-index[%s]: failed to wipe vector index '%s': %s\n", r->key, r->index_path, cberg_status_str(wipe_st));
                repo_close(r);
                return wipe_st;
            }
            if (remove(r->chunks_path) != 0 && errno != ENOENT) {
                repo_close(r);
                return CBERG_ERR_IO;
            }
            if (remove(r->manifest_path) != 0 && errno != ENOENT) {
                repo_close(r);
                return CBERG_ERR_IO;
            }
            if (r->graph_path != NULL && remove(r->graph_path) != 0 && errno != ENOENT) {
                repo_close(r);
                return CBERG_ERR_IO;
            }
            st = cberg_index_open(r->index_path, dim, &eng->index_cfg, &r->index);
        }
        if (st != CBERG_OK) {
            fprintf(stderr, "cberg-index[%s]: failed to open vector index '%s': %s\n", r->key, r->index_path, cberg_status_str(st));
            repo_close(r);
            return st;
        }
    }

    cberg_repo **grown = realloc(eng->repos, (eng->repos_len + 1) * sizeof(*grown));
    if (grown == NULL) {
        repo_close(r);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    eng->repos = grown;
    eng->repos[eng->repos_len++] = r;
    return CBERG_OK;
}

/* Resolve the roots to serve: CODEBERG_ROOTS ("<key>\t<path>" per line) wins;
 * CODEBERG_ROOT alone is the single-root fallback with key = basename. A root
 * that fails to resolve is skipped with a warning — a registry entry whose tree
 * was deleted must not keep every other repo from indexing. */
static cberg_status open_repos_from_env(cberg_engine *eng) {
    const char *roots = getenv("CODEBERG_ROOTS");
    if (roots != NULL && roots[0] != '\0') {
        char *dup = strdup(roots);
        if (dup == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        char *save = NULL;
        for (char *line = strtok_r(dup, "\n", &save); line != NULL; line = strtok_r(NULL, "\n", &save)) {
            char *tab = strchr(line, '\t');
            if (tab == NULL || tab == line || tab[1] == '\0') {
                continue; /* malformed record */
            }
            *tab = '\0';
            const char *key = line;
            const char *path = tab + 1;
            char resolved[4096];
            if (cberg_path_resolve(path, resolved, sizeof(resolved)) != CBERG_OK) {
                fprintf(stderr, "cberg-index: warning: skipping repo '%s': unresolvable root '%s'\n", key, path);
                continue;
            }
            cberg_status st = engine_add_repo(eng, key, resolved);
            if (st != CBERG_OK) {
                free(dup);
                return st;
            }
        }
        free(dup);
        if (eng->repos_len == 0) {
            fprintf(stderr, "cberg-index: no usable roots in CODEBERG_ROOTS\n");
            return CBERG_ERR_NOT_FOUND;
        }
        return CBERG_OK;
    }

    const char *root = getenv("CODEBERG_ROOT");
    if (root == NULL || root[0] == '\0') {
        return CBERG_ERR_NOT_FOUND;
    }
    char resolved[4096];
    if (cberg_config_resolve_index_root(resolved, sizeof(resolved)) != CBERG_OK) {
        if (realpath(root, resolved) == NULL) {
            return CBERG_ERR_INVALID_ARGUMENT;
        }
    }
    const char *base = strrchr(resolved, '/');
    base = (base != NULL && base[1] != '\0') ? base + 1 : "root";
    return engine_add_repo(eng, base, resolved);
}

cberg_status cberg_engine_open(cberg_engine *eng) {
    memset(eng, 0, sizeof(*eng));
    pthread_mutex_init(&eng->embed_mu, NULL);

    const char *model = getenv("CBERG_MODEL");
    const char *index_path = getenv("CBERG_INDEX_PATH");
    /* Sidecar base path is independent of vectors: chunk-only mode can still
     * persist .chunks / .manifest / .graph when CBERG_INDEX_PATH is set. */
    if (index_path != NULL && index_path[0] != '\0') {
        eng->index_base = strdup(index_path);
        if (eng->index_base == NULL) {
            cberg_engine_close(eng);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    if (model != NULL && model[0] != '\0' && eng->index_base != NULL) {
        eng->vectors = 1;
        eng->model_path = strdup(model);
        if (eng->model_path == NULL) {
            cberg_engine_close(eng);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        cberg_index_config_default(&eng->index_cfg);
        const char *backend = getenv("CBERG_INDEX_BACKEND");
        if (backend != NULL && backend[0] != '\0') {
            cberg_index_provider provider;
            if (cberg_index_provider_from_name(backend, &provider) != CBERG_OK) {
                fprintf(stderr,
                        "cberg-index: unknown CBERG_INDEX_BACKEND '%s' "
                        "(use: usearch, qdrant, pgvector, postgres)\n",
                        backend);
                cberg_engine_close(eng);
                return CBERG_ERR_INVALID_ARGUMENT;
            }
            eng->index_cfg.provider = provider;
        }
        const char *quant = getenv("CBERG_INDEX_QUANT");
        if (quant != NULL && quant[0] != '\0') {
            cberg_index_quant quantization;
            if (cberg_index_quant_from_name(quant, &quantization) != CBERG_OK) {
                fprintf(stderr,
                        "cberg-index: unknown CBERG_INDEX_QUANT '%s' "
                        "(use: f32, i8)\n",
                        quant);
                cberg_engine_close(eng);
                return CBERG_ERR_INVALID_ARGUMENT;
            }
            eng->index_cfg.quantization = quantization;
        }
        if (eng->index_cfg.provider == CBERG_INDEX_QDRANT) {
            const char *url = getenv("CBERG_VECTORDB_URL");
            if (url == NULL || url[0] == '\0') {
                fprintf(stderr,
                        "cberg-index: CBERG_VECTORDB_URL is required when CBERG_INDEX_BACKEND=qdrant\n"
                        "  e.g. CBERG_VECTORDB_URL=https://your-cluster.qdrant.io\n");
                cberg_engine_close(eng);
                return CBERG_ERR_INVALID_ARGUMENT;
            }
            eng->vectordb_url = strdup(url);
            if (eng->vectordb_url == NULL) {
                cberg_engine_close(eng);
                return CBERG_ERR_OUT_OF_MEMORY;
            }
            const char *api_key = getenv("CBERG_VECTORDB_API_KEY");
            if (api_key != NULL && api_key[0] != '\0') {
                eng->vectordb_api_key = strdup(api_key);
                if (eng->vectordb_api_key == NULL) {
                    cberg_engine_close(eng);
                    return CBERG_ERR_OUT_OF_MEMORY;
                }
            }
            eng->index_cfg.vectordb_url = eng->vectordb_url;
            eng->index_cfg.vectordb_api_key = eng->vectordb_api_key;
        } else if (eng->index_cfg.provider == CBERG_INDEX_PGVECTOR) {
            const char *url = getenv("CBERG_POSTGRES_URL");
            if (url == NULL || url[0] == '\0') {
                fprintf(stderr,
                        "cberg-index: CBERG_POSTGRES_URL is required when CBERG_INDEX_BACKEND=pgvector\n"
                        "  e.g. CBERG_POSTGRES_URL=postgresql://user:pass@host:5432/dbname\n");
                cberg_engine_close(eng);
                return CBERG_ERR_INVALID_ARGUMENT;
            }
            eng->postgres_url = strdup(url);
            if (eng->postgres_url == NULL) {
                cberg_engine_close(eng);
                return CBERG_ERR_OUT_OF_MEMORY;
            }
            eng->index_cfg.postgres_url = eng->postgres_url;
        }
    }

    /* Graph sidecar (ADR 0005): on by default, CBERG_GRAPH=0 is the kill
     * switch. CBERG_GRAPH_MODE only knows "fast" (syntactic) today; other
     * modes fall back with a warning rather than failing startup. */
    eng->graph_enabled = 1;
    const char *graph_env = getenv("CBERG_GRAPH");
    if (graph_env != NULL && (strcmp(graph_env, "0") == 0 || strcasecmp(graph_env, "off") == 0 || strcasecmp(graph_env, "false") == 0)) {
        eng->graph_enabled = 0;
    }
    const char *graph_mode = getenv("CBERG_GRAPH_MODE");
    if (eng->graph_enabled && graph_mode != NULL && graph_mode[0] != '\0' && strcasecmp(graph_mode, "fast") != 0) {
        fprintf(stderr, "cberg-index: CBERG_GRAPH_MODE '%s' not implemented yet; using 'fast'\n", graph_mode);
    }

    eng->poll_ms = 1000;
    const char *poll = getenv("CBERG_POLL_MS");
    if (poll != NULL && poll[0] != '\0') {
        eng->poll_ms = atoi(poll);
        if (eng->poll_ms < 0) {
            cberg_engine_close(eng);
            return CBERG_ERR_INVALID_ARGUMENT;
        }
    }
    if (eng->poll_ms <= 0) {
        eng->poll_ms = 1000;
    }

    const char *sock = getenv("CBERG_SOCKET");
    if (sock != NULL && sock[0] != '\0') {
        eng->socket_path = strdup(sock);
    } else {
        eng->socket_path = strdup("/tmp/codeberg-index.sock");
    }
    if (eng->socket_path == NULL) {
        cberg_engine_close(eng);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = cberg_chunker_open(&eng->chunker);
    if (st != CBERG_OK) {
        cberg_engine_close(eng);
        return st;
    }

    if (eng->vectors) {
        struct stat mst;
        if (stat(eng->model_path, &mst) != 0) {
            fprintf(stderr,
                    "cberg-index: embedding model not found: '%s'\n"
                    "  fetch one with scripts/fetch-model.sh and point CBERG_MODEL at its .onnx,\n"
                    "  or unset CBERG_MODEL and CBERG_INDEX_PATH to run chunk-only.\n",
                    eng->model_path);
            cberg_engine_close(eng);
            return CBERG_ERR_IO;
        }
        cberg_embed_config ecfg = {0};
        ecfg.provider = CBERG_EMBED_ONNX;
        ecfg.model_path = eng->model_path;
        /* CBERG_EMBED_THREADS caps ONNX intra-op threads; unset or <= 0 uses all cores. */
        const char *embed_threads = getenv("CBERG_EMBED_THREADS");
        if (embed_threads != NULL && embed_threads[0] != '\0') {
            ecfg.num_threads = atoi(embed_threads);
        }
        st = cberg_embedder_open(&ecfg, &eng->embedder);
        if (st != CBERG_OK) {
            fprintf(stderr, "cberg-index: failed to load embedding model '%s': %s\n", eng->model_path, cberg_status_str(st));
            cberg_engine_close(eng);
            return st;
        }
    }

    st = open_repos_from_env(eng);
    if (st != CBERG_OK) {
        cberg_engine_close(eng);
        return st;
    }
    return CBERG_OK;
}

void cberg_engine_close(cberg_engine *eng) {
    if (eng == NULL) {
        return;
    }
    eng->stop = 1;
    for (size_t i = 0; i < eng->repos_len; i++) {
        repo_close(eng->repos[i]);
    }
    free(eng->repos);
    if (eng->embedder != NULL) {
        cberg_embedder_close(eng->embedder);
    }
    if (eng->chunker != NULL) {
        cberg_chunker_close(eng->chunker);
    }
    free(eng->model_path);
    free(eng->index_base);
    free(eng->vectordb_url);
    free(eng->vectordb_api_key);
    free(eng->postgres_url);
    free(eng->socket_path);
    pthread_mutex_destroy(&eng->embed_mu);
    memset(eng, 0, sizeof(*eng));
}

/* ------------------------------------------------------------- bootstrap */

/* Walk every file, chunk it, and capture a manifest baseline for next time. The
 * caller holds r->mu. Used both on a true cold start (empty table) and as the
 * fallback when a chunk table was restored but no manifest was: in the latter
 * case unchanged chunks still keep their ids, so sync re-embeds nothing. */
static cberg_status walk_and_sync(cberg_repo *r) {
    chunk_batch batch;
    batch_init(&batch);
    walk_ctx ctx = {.repo = r, .batch = &batch};
    if (cberg_fs_walk_files(r->root, bootstrap_cb, &ctx) != 0) {
        batch_reset(&batch);
        return ctx.err != CBERG_OK ? ctx.err : CBERG_ERR_IO;
    }
    cberg_status st = sync_table(r, &batch);
    batch_reset(&batch);
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
    resolve_imports(r);
    return CBERG_OK;
}

cberg_status cberg_repo_bootstrap(cberg_repo *r) {
    pthread_mutex_lock(&r->mu);

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
            pthread_mutex_unlock(&r->mu);
            return st;
        }
    }

    st = walk_and_sync(r);
    if (st == CBERG_OK) {
        r->ready = 1;
        save_state(r);
    }
    pthread_mutex_unlock(&r->mu);
    return st;
}

static cberg_status batch_add_table_except(cberg_repo *r, chunk_batch *batch, char **skip, size_t skip_n) {
    size_t n = cberg_chunk_table_len(r->table);
    for (size_t i = 0; i < n; i++) {
        const cberg_stored_chunk *sc = cberg_chunk_table_at(r->table, i);
        if (sc == NULL) {
            continue;
        }
        if (path_in_set(sc->chunk.path, skip, skip_n)) {
            continue;
        }
        if (batch->len + 1 > batch->cap) {
            size_t new_cap = batch->cap == 0 ? 64 : batch->cap * 2;
            cberg_chunk *next = realloc(batch->items, new_cap * sizeof(cberg_chunk));
            if (next == NULL) {
                return CBERG_ERR_OUT_OF_MEMORY;
            }
            batch->items = next;
            batch->cap = new_cap;
        }
        batch->items[batch->len++] = sc->chunk;
    }
    return CBERG_OK;
}

/* Re-index a set of changed paths: carry over every chunk except those of
 * `rechunk`+`deleted`, re-chunk `rechunk` from disk, and sync the union — so only
 * the affected files are parsed and only chunks whose content moved get
 * re-embedded. The path arrays are borrowed (not freed). Caller holds r->mu. */
/* Borrowed path pointers; grow like a simple string list. */
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

static cberg_status apply_path_changes(cberg_repo *r, char **rechunk, size_t rechunk_n, char **deleted, size_t deleted_n) {
    chunk_batch batch;
    batch_init(&batch);

    char **skip = NULL;
    size_t skip_n = 0;
    /* Paths whose graph nodes must be dropped after a successful table sync.
     * Deferred so a failed parse/sync cannot leave the graph ahead of the table. */
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

    cberg_status st = batch_add_table_except(r, &batch, skip, skip_n);
    if (st != CBERG_OK) {
        goto done;
    }

    for (size_t i = 0; i < rechunk_n; i++) {
        char abs[4096];
        snprintf(abs, sizeof(abs), "%s/%s", r->root, rechunk[i]);
        cberg_chunk_list *list = NULL;
        cberg_graph_fragment *frag = NULL;
        st = parse_file(r, abs, rechunk[i], &list, &frag);
        if (st != CBERG_OK) {
            goto done;
        }
        if (list != NULL) {
            st = batch_add_list(&batch, list);
            if (st != CBERG_OK) {
                cberg_chunk_list_free(list);
                cberg_graph_fragment_free(frag);
                goto done;
            }
            st = batch_add_fragment(&batch, frag);
            if (st != CBERG_OK) {
                cberg_graph_fragment_free(frag);
                goto done;
            }
        } else {
            /* Emptied / unreadable-as-chunks: drop graph after sync commits. */
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

    st = sync_table(r, &batch);
    if (st == CBERG_OK && r->graph != NULL) {
        for (size_t i = 0; i < graph_drop_n; i++) {
            cberg_graph_remove_file(r->graph, graph_drop[i]);
        }
    }

done:
    batch_reset(&batch);
    free(skip);
    free(graph_drop);
    return st;
}

typedef struct {
    cberg_repo *repo;
    cberg_status err;
} graph_walk_ctx;

static int graph_rebuild_cb(const char *abs, const char *rel, void *v) {
    graph_walk_ctx *ctx = v;
    cberg_chunk_list *list = NULL;
    cberg_graph_fragment *frag = NULL;
    cberg_status st = parse_file(ctx->repo, abs, rel, &list, &frag);
    if (st != CBERG_OK) {
        ctx->err = st;
        return -1;
    }
    if (frag != NULL) {
        st = cberg_graph_apply(ctx->repo->graph, frag, graph_key_resolver, ctx->repo->table);
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
    graph_walk_ctx ctx = {.repo = r};
    if (cberg_fs_walk_files(r->root, graph_rebuild_cb, &ctx) != 0) {
        fprintf(stderr, "cberg-index[%s]: warning: graph rebuild walk failed (%s); graph is partial\n", r->key, cberg_status_str(ctx.err != CBERG_OK ? ctx.err : CBERG_ERR_IO));
    }
    resolve_imports(r);
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
            save_state(r);
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
    st = apply_path_changes(r, rechunk, rechunk_n, (char **)diff.deleted, diff.deleted_len);
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
        resolve_imports(r);
    }
    save_state(r);
    return CBERG_OK;
}

/* -------------------------------------------------------------- watch loop */

/* Drain one repo's watcher (non-blocking) and apply any changes. */
static cberg_status repo_step(cberg_repo *r, size_t *out_events) {
    *out_events = 0;

    cberg_watch_event events[256];
    size_t count = 0;
    cberg_status st = cberg_watcher_poll(r->watcher, events, 256, &count, 0);
    if (st == CBERG_ERR_TIMEOUT) {
        return CBERG_OK;
    }
    if (st != CBERG_OK) {
        return st;
    }
    if (count == 0) {
        return CBERG_OK;
    }

    char **rechunk = calloc(count, sizeof(*rechunk));
    char **deleted = calloc(count, sizeof(*deleted));
    size_t rechunk_n = 0;
    size_t deleted_n = 0;
    if (rechunk == NULL || deleted == NULL) {
        free(rechunk);
        free(deleted);
        for (size_t i = 0; i < count; i++) {
            free((void *)events[i].path);
        }
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    for (size_t i = 0; i < count; i++) {
        if (events[i].kind == CBERG_WATCH_DELETE) {
            deleted[deleted_n++] = strdup(events[i].path);
        } else {
            rechunk[rechunk_n++] = strdup(events[i].path);
        }
        free((void *)events[i].path);
    }

    pthread_mutex_lock(&r->mu);
    st = apply_path_changes(r, rechunk, rechunk_n, deleted, deleted_n);
    if (st == CBERG_OK) {
        /* Persist chunk table + graph every sync so a restart never re-embeds
         * or loses structural work done this session. Manifest baseline is
         * refreshed on close. Re-resolve imports so new relative/module paths
         * become FILE edges without waiting for a cold restart. */
        resolve_imports(r);
        save_chunk_table(r);
        save_graph(r);
    }
    pthread_mutex_unlock(&r->mu);

    for (size_t i = 0; i < rechunk_n; i++) {
        free(rechunk[i]);
    }
    for (size_t i = 0; i < deleted_n; i++) {
        free(deleted[i]);
    }
    free(rechunk);
    free(deleted);

    if (st == CBERG_OK) {
        *out_events = count;
    }
    return st;
}

cberg_status cberg_engine_step(cberg_engine *eng, size_t *out_events) {
    size_t total = 0;
    for (size_t i = 0; i < eng->repos_len; i++) {
        if (eng->stop) {
            break;
        }
        size_t n = 0;
        cberg_status st = repo_step(eng->repos[i], &n);
        if (st != CBERG_OK) {
            return st;
        }
        total += n;
    }
    if (out_events != NULL) {
        *out_events = total;
    }
    return CBERG_OK;
}

cberg_status cberg_engine_run(cberg_engine *eng) {
    for (;;) {
        if (eng->stop) {
            return CBERG_OK;
        }
        size_t handled = 0;
        cberg_status st = cberg_engine_step(eng, &handled);
        if (st != CBERG_OK) {
            return st;
        }
        if (handled == 0) {
            /* Idle: every watcher was drained non-blocking, so pace the loop.
             * A signal interrupts the sleep and the stop check runs first. */
            struct timespec ts = {.tv_sec = eng->poll_ms / 1000, .tv_nsec = (long)(eng->poll_ms % 1000) * 1000000L};
            nanosleep(&ts, NULL);
        }
    }
}

/* ------------------------------------------------------------------ search */

static const char *kind_str(cberg_chunk_kind k) {
    switch (k) {
    case CBERG_CHUNK_FUNCTION:
        return "function";
    case CBERG_CHUNK_METHOD:
        return "method";
    case CBERG_CHUNK_CLASS:
        return "class";
    case CBERG_CHUNK_STRUCT:
        return "struct";
    case CBERG_CHUNK_INTERFACE:
        return "interface";
    case CBERG_CHUNK_WINDOW:
        return "window";
    case CBERG_CHUNK_SECTION:
        return "section";
    case CBERG_CHUNK_KEY:
        return "key";
    case CBERG_CHUNK_UNKNOWN:
    default:
        return "unknown";
    }
}

int cberg_index_parse_kind(const char *s) {
    if (s == NULL || s[0] == '\0') {
        return -1;
    }
    if (strcasecmp(s, "function") == 0) {
        return CBERG_CHUNK_FUNCTION;
    }
    if (strcasecmp(s, "method") == 0) {
        return CBERG_CHUNK_METHOD;
    }
    if (strcasecmp(s, "class") == 0) {
        return CBERG_CHUNK_CLASS;
    }
    if (strcasecmp(s, "struct") == 0) {
        return CBERG_CHUNK_STRUCT;
    }
    if (strcasecmp(s, "interface") == 0) {
        return CBERG_CHUNK_INTERFACE;
    }
    if (strcasecmp(s, "window") == 0) {
        return CBERG_CHUNK_WINDOW;
    }
    if (strcasecmp(s, "section") == 0) {
        return CBERG_CHUNK_SECTION;
    }
    if (strcasecmp(s, "key") == 0) {
        return CBERG_CHUNK_KEY;
    }
    return -1;
}

static int chunk_passes_filters(const cberg_stored_chunk *sc, float score, const cberg_search_filters *f) {
    if (f == NULL) {
        return 1;
    }
    if (f->min_score > 0.0f && score < f->min_score) {
        return 0;
    }
    if (f->kind >= 0 && (int)sc->chunk.kind != f->kind) {
        return 0;
    }
    if (f->path_glob != NULL && f->path_glob[0] != '\0') {
        const char *path = sc->chunk.path != NULL ? sc->chunk.path : "";
        if (fnmatch(f->path_glob, path, FNM_PATHNAME) != 0) {
            return 0;
        }
    }
    return 1;
}

static cberg_repo *find_repo(cberg_engine *eng, const char *repo_key) {
    if (repo_key == NULL || repo_key[0] == '\0') {
        return NULL;
    }
    for (size_t i = 0; i < eng->repos_len; i++) {
        if (strcmp(eng->repos[i]->key, repo_key) == 0) {
            return eng->repos[i];
        }
    }
    return NULL;
}

static void fill_snippet(cberg_repo *r, const cberg_stored_chunk *sc, char *out, size_t cap) {
    out[0] = '\0';
    if (sc == NULL || cap == 0) {
        return;
    }
    size_t blen = 0;
    char *body = chunk_body(r, sc, &blen);
    if (body == NULL) {
        return;
    }
    uint32_t start = sc->chunk.span.start_byte;
    uint32_t end = sc->chunk.span.end_byte;
    if (end > blen || start > end) {
        free(body);
        return;
    }
    size_t len = (size_t)(end - start);
    if (len >= cap) {
        len = cap - 1;
    }
    memcpy(out, body + start, len);
    out[len] = '\0';
    free(body);
}

#define CBERG_FILTER_FETCH_MAX 256

static int search_filters_active(const cberg_search_filters *filters) {
    return filters != NULL &&
           (filters->path_glob != NULL || filters->kind >= 0 || filters->min_score > 0.0f);
}

static int hit_id_seen(const uint64_t *seen, size_t seen_len, uint64_t id) {
    for (size_t i = 0; i < seen_len; i++) {
        if (seen[i] == id) {
            return 1;
        }
    }
    return 0;
}

/* Search one repo with an already-embedded query, copying chunk metadata into
 * hits while r->mu is held. NOT_FOUND when the repo is not ready yet. */
static cberg_status repo_search_hits(cberg_repo *r, const float *vec, size_t k, const cberg_search_filters *filters, cberg_engine_hit *hits, size_t cap, size_t *found) {
    *found = 0;
    pthread_mutex_lock(&r->mu);
    if (!r->ready || r->index == NULL) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }

    const int filtered = search_filters_active(filters);
    size_t fetch = filtered ? 64 : k;

    uint64_t ids[CBERG_FILTER_FETCH_MAX];
    float scores[CBERG_FILTER_FETCH_MAX];
    uint64_t seen_ids[CBERG_FILTER_FETCH_MAX];
    size_t seen_len = 0;
    cberg_search_config search_cfg;
    cberg_search_config_default(&search_cfg);
    if (filtered) {
        search_cfg.oversample = 8;
        search_cfg.min_expansion_search = 128;
    }

    for (;;) {
        size_t n = 0;
        cberg_status st = cberg_search_vector(r->index, vec, filtered ? &search_cfg : NULL, fetch, ids, scores, &n);
        if (st != CBERG_OK) {
            pthread_mutex_unlock(&r->mu);
            return st;
        }

        for (size_t i = 0; i < n && *found < k && *found < cap; i++) {
            if (hit_id_seen(seen_ids, seen_len, ids[i])) {
                continue;
            }
            if (seen_len < CBERG_FILTER_FETCH_MAX) {
                seen_ids[seen_len++] = ids[i];
            }

            const cberg_stored_chunk *sc = cberg_chunk_table_find_by_id(r->table, ids[i]);
            if (sc == NULL) {
                continue;
            }
            if (!chunk_passes_filters(sc, scores[i], filters)) {
                continue;
            }
            cberg_engine_hit *h = &hits[*found];
            h->id = ids[i];
            h->score = scores[i];
            h->repo = r->key;
            snprintf(h->path, sizeof(h->path), "%s", sc->chunk.path != NULL ? sc->chunk.path : "");
            snprintf(h->symbol, sizeof(h->symbol), "%s", sc->chunk.symbol != NULL ? sc->chunk.symbol : "");
            h->start_line = sc->chunk.span.start_line;
            h->end_line = sc->chunk.span.end_line;
            h->snippet[0] = '\0';
            fill_snippet(r, sc, h->snippet, sizeof(h->snippet));
            (*found)++;
        }

        if (*found >= k || !filtered) {
            break;
        }
        if (n < fetch || fetch >= CBERG_FILTER_FETCH_MAX) {
            break;
        }
        size_t next = fetch * 2;
        fetch = next > CBERG_FILTER_FETCH_MAX ? CBERG_FILTER_FETCH_MAX : next;
    }

    pthread_mutex_unlock(&r->mu);
    return CBERG_OK;
}

static int hit_score_desc(const void *a, const void *b) {
    float sa = ((const cberg_engine_hit *)a)->score;
    float sb = ((const cberg_engine_hit *)b)->score;
    if (sa > sb) {
        return -1;
    }
    if (sa < sb) {
        return 1;
    }
    return 0;
}

static int hit_line_asc(const void *a, const void *b) {
    uint32_t la = ((const cberg_engine_hit *)a)->start_line;
    uint32_t lb = ((const cberg_engine_hit *)b)->start_line;
    if (la < lb) {
        return -1;
    }
    if (la > lb) {
        return 1;
    }
    return 0;
}

cberg_status cberg_engine_search_hits(cberg_engine *eng, const char *query, const char *repo_key, size_t k, const cberg_search_filters *filters, cberg_engine_hit *hits, size_t cap, size_t *found) {
    if (hits == NULL || found == NULL || query == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *found = 0;
    if (cap == 0 || k == 0) {
        return CBERG_OK;
    }
    if (k > cap) {
        k = cap;
    }
    if (k > 64) {
        k = 64;
    }
    if (!eng->vectors || eng->embedder == NULL) {
        return CBERG_ERR_NOT_IMPLEMENTED;
    }
    if (repo_key != NULL && repo_key[0] == '\0') {
        repo_key = NULL;
    }

    cberg_repo *only = find_repo(eng, repo_key);
    if (repo_key != NULL && only == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }

    /* Embed the query once (under embed_mu alone — never while holding a repo
     * lock), then vector-search each target index. */
    const char *texts[1] = {query};
    size_t lens[1] = {strlen(query)};
    float *vec = NULL;
    cberg_status st = engine_embed(eng, texts, lens, 1, &vec);
    if (st != CBERG_OK) {
        return st;
    }

    if (only != NULL) {
        st = repo_search_hits(only, vec, k, filters, hits, cap, found);
        cberg_vectors_free(vec);
        return st;
    }

    cberg_engine_hit *all = malloc(eng->repos_len * k * sizeof(*all));
    if (all == NULL) {
        cberg_vectors_free(vec);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t n = 0;
    size_t searched = 0;
    st = CBERG_OK;
    for (size_t i = 0; i < eng->repos_len; i++) {
        size_t got = 0;
        cberg_status rst = repo_search_hits(eng->repos[i], vec, k, filters, all + n, k, &got);
        if (rst == CBERG_OK) {
            n += got;
            searched++;
        } else if (rst != CBERG_ERR_NOT_FOUND) {
            st = rst; /* a real search failure; not-ready repos are just skipped */
            break;
        }
    }
    cberg_vectors_free(vec);
    if (st != CBERG_OK) {
        free(all);
        return st;
    }
    if (searched == 0) {
        free(all);
        return CBERG_ERR_NOT_FOUND;
    }

    qsort(all, n, sizeof(*all), hit_score_desc);
    for (size_t i = 0; i < n && *found < k; i++) {
        hits[(*found)++] = all[i];
    }
    free(all);
    return CBERG_OK;
}

void cberg_engine_chunk_detail_free(cberg_engine_chunk_detail *d) {
    if (d == NULL) {
        return;
    }
    free(d->body);
    d->body = NULL;
    d->body_len = 0;
}

static cberg_status fill_chunk_detail(cberg_repo *r, const cberg_stored_chunk *sc, cberg_engine_chunk_detail *out) {
    memset(out, 0, sizeof(*out));
    out->id = sc->id;
    out->repo = r->key;
    snprintf(out->path, sizeof(out->path), "%s", sc->chunk.path != NULL ? sc->chunk.path : "");
    snprintf(out->symbol, sizeof(out->symbol), "%s", sc->chunk.symbol != NULL ? sc->chunk.symbol : "");
    snprintf(out->kind, sizeof(out->kind), "%s", kind_str(sc->chunk.kind));
    out->start_line = sc->chunk.span.start_line;
    out->end_line = sc->chunk.span.end_line;
    fill_snippet(r, sc, out->snippet, sizeof(out->snippet));

    size_t blen = 0;
    char *file = chunk_body(r, sc, &blen);
    if (file == NULL) {
        return CBERG_ERR_IO;
    }
    uint32_t start = sc->chunk.span.start_byte;
    uint32_t end = sc->chunk.span.end_byte;
    if (end > blen || start > end) {
        free(file);
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    size_t len = (size_t)(end - start);
    out->truncated = len > CBERG_CHUNK_BODY_MAX ? 1 : 0;
    if (len > CBERG_CHUNK_BODY_MAX) {
        len = CBERG_CHUNK_BODY_MAX;
    }
    out->body = malloc(len + 1);
    if (out->body == NULL) {
        free(file);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    memcpy(out->body, file + start, len);
    out->body[len] = '\0';
    out->body_len = len;
    free(file);
    return CBERG_OK;
}

cberg_status cberg_engine_get_chunk(cberg_engine *eng, const char *repo_key, uint64_t id, cberg_engine_chunk_detail *out) {
    if (eng == NULL || repo_key == NULL || out == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_repo *r = find_repo(eng, repo_key);
    if (r == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    cberg_status st;
    pthread_mutex_lock(&r->mu);
    if (!r->ready) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    const cberg_stored_chunk *sc = cberg_chunk_table_find_by_id(r->table, id);
    if (sc == NULL) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    st = fill_chunk_detail(r, sc, out);
    pthread_mutex_unlock(&r->mu);
    return st;
}

static int symbol_matches(const char *symbol, const char *name) {
    if (symbol == NULL || name == NULL || name[0] == '\0') {
        return 0;
    }
    if (strcasecmp(symbol, name) == 0) {
        return 1;
    }
    /* Case-insensitive substring for partial matches. */
    size_t nlen = strlen(name);
    for (const char *p = symbol; *p != '\0'; p++) {
        if (strncasecmp(p, name, nlen) == 0) {
            return 1;
        }
    }
    return 0;
}

static cberg_status repo_find_symbol(cberg_repo *r, const char *name, int kind, size_t limit, cberg_engine_hit *hits, size_t cap, size_t *found) {
    *found = 0;
    pthread_mutex_lock(&r->mu);
    if (!r->ready) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    size_t n = cberg_chunk_table_len(r->table);
    for (size_t i = 0; i < n && *found < cap && *found < limit; i++) {
        const cberg_stored_chunk *sc = cberg_chunk_table_at(r->table, i);
        if (sc == NULL) {
            continue;
        }
        if (kind >= 0 && (int)sc->chunk.kind != kind) {
            continue;
        }
        if (!symbol_matches(sc->chunk.symbol, name)) {
            continue;
        }
        cberg_engine_hit *h = &hits[*found];
        h->id = sc->id;
        h->score = 1.0f;
        h->repo = r->key;
        snprintf(h->path, sizeof(h->path), "%s", sc->chunk.path != NULL ? sc->chunk.path : "");
        snprintf(h->symbol, sizeof(h->symbol), "%s", sc->chunk.symbol != NULL ? sc->chunk.symbol : "");
        h->start_line = sc->chunk.span.start_line;
        h->end_line = sc->chunk.span.end_line;
        h->snippet[0] = '\0';
        fill_snippet(r, sc, h->snippet, sizeof(h->snippet));
        (*found)++;
    }
    pthread_mutex_unlock(&r->mu);
    return CBERG_OK;
}

cberg_status cberg_engine_find_symbol(cberg_engine *eng, const char *name, const char *repo_key, int kind, size_t limit, cberg_engine_hit *hits, size_t cap, size_t *found) {
    if (eng == NULL || name == NULL || hits == NULL || found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *found = 0;
    if (cap == 0 || limit == 0) {
        return CBERG_OK;
    }
    if (limit > cap) {
        limit = cap;
    }
    if (limit > 64) {
        limit = 64;
    }
    if (repo_key != NULL && repo_key[0] == '\0') {
        repo_key = NULL;
    }

    if (repo_key != NULL) {
        cberg_repo *r = find_repo(eng, repo_key);
        if (r == NULL) {
            return CBERG_ERR_NOT_FOUND;
        }
        return repo_find_symbol(r, name, kind, limit, hits, cap, found);
    }

    size_t searched = 0;
    for (size_t i = 0; i < eng->repos_len && *found < limit; i++) {
        size_t got = 0;
        cberg_status st = repo_find_symbol(eng->repos[i], name, kind, limit - *found, hits + *found, cap - *found, &got);
        if (st == CBERG_OK) {
            *found += got;
            searched++;
        } else if (st != CBERG_ERR_NOT_FOUND) {
            return st;
        }
    }
    if (searched == 0) {
        return CBERG_ERR_NOT_FOUND;
    }
    return CBERG_OK;
}

static cberg_status repo_file_outline(cberg_repo *r, const char *path, cberg_engine_hit *hits, size_t cap, size_t *found) {
    *found = 0;
    pthread_mutex_lock(&r->mu);
    if (!r->ready) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    size_t n = cberg_chunk_table_len(r->table);
    for (size_t i = 0; i < n && *found < cap; i++) {
        const cberg_stored_chunk *sc = cberg_chunk_table_at(r->table, i);
        if (sc == NULL || sc->chunk.path == NULL || strcmp(sc->chunk.path, path) != 0) {
            continue;
        }
        cberg_engine_hit *h = &hits[*found];
        h->id = sc->id;
        h->score = 1.0f;
        h->repo = r->key;
        snprintf(h->path, sizeof(h->path), "%s", sc->chunk.path);
        snprintf(h->symbol, sizeof(h->symbol), "%s", sc->chunk.symbol != NULL ? sc->chunk.symbol : "");
        h->start_line = sc->chunk.span.start_line;
        h->end_line = sc->chunk.span.end_line;
        h->snippet[0] = '\0';
        fill_snippet(r, sc, h->snippet, sizeof(h->snippet));
        (*found)++;
    }
    pthread_mutex_unlock(&r->mu);
    if (*found == 0) {
        return CBERG_ERR_NOT_FOUND;
    }
    qsort(hits, *found, sizeof(*hits), hit_line_asc);
    return CBERG_OK;
}

cberg_status cberg_engine_file_outline(cberg_engine *eng, const char *repo_key, const char *path, cberg_engine_hit *hits, size_t cap, size_t *found) {
    if (eng == NULL || repo_key == NULL || path == NULL || hits == NULL || found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_repo *r = find_repo(eng, repo_key);
    if (r == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    return repo_file_outline(r, path, hits, cap, found);
}

static const char *gnode_kind_str(cberg_graph_node_kind k) {
    switch (k) {
    case CBERG_GNODE_FILE:
        return "file";
    case CBERG_GNODE_FUNCTION:
        return "function";
    case CBERG_GNODE_METHOD:
        return "method";
    case CBERG_GNODE_CLASS:
        return "class";
    case CBERG_GNODE_STRUCT:
        return "struct";
    case CBERG_GNODE_INTERFACE:
        return "interface";
    case CBERG_GNODE_MODULE:
        return "module";
    default:
        return "unknown";
    }
}

static const char *gedge_kind_str(cberg_graph_edge_kind k) {
    switch (k) {
    case CBERG_GEDGE_DEFINES:
        return "defines";
    case CBERG_GEDGE_CONTAINS:
        return "contains";
    case CBERG_GEDGE_IMPORTS:
        return "imports";
    case CBERG_GEDGE_CALLS:
        return "calls";
    case CBERG_GEDGE_INHERITS:
        return "inherits";
    case CBERG_GEDGE_REFERENCES:
        return "references";
    default:
        return "unknown";
    }
}

static const char *gres_str(cberg_graph_resolution r) {
    switch (r) {
    case CBERG_GRES_TEXTUAL:
        return "textual";
    case CBERG_GRES_IMPORT:
        return "import";
    case CBERG_GRES_TYPED:
        return "typed";
    default:
        return "unknown";
    }
}

uint32_t cberg_index_parse_gnode_mask(const char *s) {
    if (s == NULL || s[0] == '\0') {
        return 0;
    }
    if (strcasecmp(s, "file") == 0) {
        return CBERG_GNODE_MASK(CBERG_GNODE_FILE);
    }
    if (strcasecmp(s, "function") == 0) {
        return CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION);
    }
    if (strcasecmp(s, "method") == 0) {
        return CBERG_GNODE_MASK(CBERG_GNODE_METHOD);
    }
    if (strcasecmp(s, "class") == 0) {
        return CBERG_GNODE_MASK(CBERG_GNODE_CLASS);
    }
    if (strcasecmp(s, "struct") == 0) {
        return CBERG_GNODE_MASK(CBERG_GNODE_STRUCT);
    }
    if (strcasecmp(s, "interface") == 0) {
        return CBERG_GNODE_MASK(CBERG_GNODE_INTERFACE);
    }
    if (strcasecmp(s, "module") == 0) {
        return CBERG_GNODE_MASK(CBERG_GNODE_MODULE);
    }
    if (strcasecmp(s, "symbol") == 0) {
        return CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION) | CBERG_GNODE_MASK(CBERG_GNODE_METHOD) | CBERG_GNODE_MASK(CBERG_GNODE_CLASS) |
               CBERG_GNODE_MASK(CBERG_GNODE_STRUCT) | CBERG_GNODE_MASK(CBERG_GNODE_INTERFACE);
    }
    return 0;
}

uint32_t cberg_index_parse_gedge_mask(const char *s) {
    if (s == NULL || s[0] == '\0') {
        return 0;
    }
    if (strcasecmp(s, "defines") == 0) {
        return CBERG_GEDGE_DEFINES;
    }
    if (strcasecmp(s, "contains") == 0) {
        return CBERG_GEDGE_CONTAINS;
    }
    if (strcasecmp(s, "imports") == 0) {
        return CBERG_GEDGE_IMPORTS;
    }
    if (strcasecmp(s, "calls") == 0) {
        return CBERG_GEDGE_CALLS;
    }
    if (strcasecmp(s, "inherits") == 0) {
        return CBERG_GEDGE_INHERITS;
    }
    if (strcasecmp(s, "references") == 0) {
        return CBERG_GEDGE_REFERENCES;
    }
    if (strcasecmp(s, "all") == 0) {
        return CBERG_GEDGE_ALL;
    }
    return 0;
}

static void copy_cstr(char *dst, size_t cap, const char *src) {
    if (cap == 0) {
        return;
    }
    if (src == NULL) {
        dst[0] = '\0';
        return;
    }
    snprintf(dst, cap, "%s", src);
}

static void fill_engine_gnode(cberg_engine_graph_node *out, const char *repo, const cberg_graph_node *n) {
    out->id = n->id;
    out->repo = repo;
    copy_cstr(out->kind, sizeof(out->kind), gnode_kind_str(n->kind));
    copy_cstr(out->name, sizeof(out->name), n->name);
    copy_cstr(out->qname, sizeof(out->qname), n->qname);
    copy_cstr(out->path, sizeof(out->path), n->path);
    out->start_line = n->span.start_line;
    out->end_line = n->span.end_line;
}

static void fill_engine_gedge(cberg_engine_graph_edge *out, const cberg_graph *g, const cberg_graph_edge *e) {
    out->src = e->src;
    out->dst = e->dst;
    copy_cstr(out->kind, sizeof(out->kind), gedge_kind_str(e->kind));
    copy_cstr(out->resolution, sizeof(out->resolution), gres_str(e->resolution));
    out->confidence = e->confidence;
    out->line = e->line;
    const cberg_graph_node *src = cberg_graph_node_by_id(g, e->src);
    const cberg_graph_node *dst = cberg_graph_node_by_id(g, e->dst);
    copy_cstr(out->src_name, sizeof(out->src_name), src != NULL ? src->name : NULL);
    copy_cstr(out->dst_name, sizeof(out->dst_name), dst != NULL ? dst->name : NULL);
    copy_cstr(out->src_path, sizeof(out->src_path), src != NULL ? src->path : NULL);
    copy_cstr(out->dst_path, sizeof(out->dst_path), dst != NULL ? dst->path : NULL);
}

/* Pick a ready repo for graph queries. Explicit key must exist; otherwise the
 * first ready repo with a live graph wins (single-repo default). */
static cberg_status graph_repo(cberg_engine *eng, const char *repo_key, cberg_repo **out) {
    *out = NULL;
    if (!eng->graph_enabled) {
        return CBERG_ERR_NOT_IMPLEMENTED;
    }
    if (repo_key != NULL && repo_key[0] != '\0') {
        cberg_repo *r = find_repo(eng, repo_key);
        if (r == NULL) {
            return CBERG_ERR_NOT_FOUND;
        }
        if (r->graph == NULL) {
            return CBERG_ERR_NOT_IMPLEMENTED;
        }
        *out = r;
        return CBERG_OK;
    }
    for (size_t i = 0; i < eng->repos_len; i++) {
        cberg_repo *r = eng->repos[i];
        if (cberg_repo_ready(r) && r->graph != NULL) {
            *out = r;
            return CBERG_OK;
        }
    }
    return CBERG_ERR_NOT_FOUND;
}

cberg_status cberg_engine_search_graph(cberg_engine *eng, const char *name, const char *repo_key, const char *kind, const char *path_prefix, size_t limit, cberg_engine_graph_node *out, size_t cap, size_t *found) {
    if (eng == NULL || out == NULL || found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *found = 0;
    cberg_repo *r = NULL;
    cberg_status st = graph_repo(eng, repo_key, &r);
    if (st != CBERG_OK) {
        return st;
    }
    if (limit == 0) {
        limit = 20;
    }
    if (limit > cap) {
        limit = cap;
    }
    uint32_t kind_mask = cberg_index_parse_gnode_mask(kind);
    const char *name_filter = (name != NULL && name[0] != '\0') ? name : NULL;
    const char *path_filter = (path_prefix != NULL && path_prefix[0] != '\0') ? path_prefix : NULL;

    const cberg_graph_node *nodes[64];
    size_t n = 0;
    size_t want = limit > 64 ? 64 : limit;
    pthread_mutex_lock(&r->mu);
    if (!r->ready || r->graph == NULL) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    st = cberg_graph_find_nodes(r->graph, name_filter, kind_mask, path_filter, nodes, want, &n);
    if (st == CBERG_OK) {
        for (size_t i = 0; i < n; i++) {
            fill_engine_gnode(&out[i], r->key, nodes[i]);
        }
        *found = n;
    }
    pthread_mutex_unlock(&r->mu);
    return st;
}

cberg_status cberg_engine_trace_path(cberg_engine *eng, const char *name, uint64_t start_id, const char *repo_key, const char *path_prefix, const char *direction, const char *edge_kind, uint32_t max_depth, size_t limit, cberg_engine_graph_hop *out, size_t cap, size_t *found) {
    if (eng == NULL || out == NULL || found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *found = 0;
    cberg_repo *r = NULL;
    cberg_status st = graph_repo(eng, repo_key, &r);
    if (st != CBERG_OK) {
        return st;
    }
    if (limit == 0) {
        limit = 64;
    }
    if (limit > cap) {
        limit = cap;
    }
    if (max_depth == 0) {
        max_depth = 2;
    }

    uint32_t dirs = CBERG_GRAPH_IN | CBERG_GRAPH_OUT;
    if (direction != NULL && direction[0] != '\0') {
        if (strcasecmp(direction, "out") == 0) {
            dirs = CBERG_GRAPH_OUT;
        } else if (strcasecmp(direction, "in") == 0) {
            dirs = CBERG_GRAPH_IN;
        } else if (strcasecmp(direction, "both") != 0) {
            return CBERG_ERR_INVALID_ARGUMENT;
        }
    }

    uint32_t kind_mask = cberg_index_parse_gedge_mask(edge_kind);
    if (kind_mask == 0) {
        kind_mask = CBERG_GEDGE_CALLS;
    }

    pthread_mutex_lock(&r->mu);
    if (!r->ready || r->graph == NULL) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }

    uint64_t id = start_id;
    if (id == 0) {
        if (name == NULL || name[0] == '\0') {
            pthread_mutex_unlock(&r->mu);
            return CBERG_ERR_INVALID_ARGUMENT;
        }
        const cberg_graph_node *nodes[16];
        size_t n = 0;
        /* Prefer exact path match when path_prefix is a full path; fall back to
         * prefix filter so callers can still pass a directory. */
        const char *path_filter = (path_prefix != NULL && path_prefix[0] != '\0') ? path_prefix : NULL;
        st = cberg_graph_find_nodes(r->graph, name, 0, path_filter, nodes, 16, &n);
        if (st != CBERG_OK || n == 0) {
            pthread_mutex_unlock(&r->mu);
            return CBERG_ERR_NOT_FOUND;
        }
        id = nodes[0]->id;
        if (path_filter != NULL) {
            for (size_t i = 0; i < n; i++) {
                if (nodes[i]->path != NULL && strcmp(nodes[i]->path, path_filter) == 0) {
                    id = nodes[i]->id;
                    break;
                }
            }
        }
    }

    cberg_graph_hop hops[256];
    size_t hop_n = 0;
    size_t want = limit > 256 ? 256 : limit;
    st = cberg_graph_trace(r->graph, id, dirs, kind_mask, max_depth, hops, want, &hop_n);
    if (st == CBERG_OK) {
        for (size_t i = 0; i < hop_n; i++) {
            fill_engine_gedge(&out[i].edge, r->graph, &hops[i].edge);
            out[i].depth = hops[i].depth;
        }
        *found = hop_n;
    }
    pthread_mutex_unlock(&r->mu);
    return st;
}

static const char *lang_name(cberg_language lang) {
    switch (lang) {
    case CBERG_LANG_GO:
        return "go";
    case CBERG_LANG_TYPESCRIPT:
        return "typescript";
    case CBERG_LANG_JAVASCRIPT:
        return "javascript";
    case CBERG_LANG_C:
        return "c";
    case CBERG_LANG_KOTLIN:
        return "kotlin";
    case CBERG_LANG_PYTHON:
        return "python";
    case CBERG_LANG_JAVA:
        return "java";
    case CBERG_LANG_RUST:
        return "rust";
    case CBERG_LANG_RUBY:
        return "ruby";
    case CBERG_LANG_MARKDOWN:
    case CBERG_LANG_YAML:
    case CBERG_LANG_TOML:
    case CBERG_LANG_JSON:
    case CBERG_LANG_UNKNOWN:
        return NULL;
    default:
        return NULL;
    }
}

static void bump_lang(cberg_engine_graph_stats *out, const char *lang) {
    if (lang == NULL) {
        return;
    }
    for (size_t i = 0; i < out->languages_len; i++) {
        if (strcmp(out->languages[i].lang, lang) == 0) {
            out->languages[i].files++;
            return;
        }
    }
    if (out->languages_len >= sizeof(out->languages) / sizeof(out->languages[0])) {
        return;
    }
    copy_cstr(out->languages[out->languages_len].lang, sizeof(out->languages[0].lang), lang);
    out->languages[out->languages_len].files = 1;
    out->languages_len++;
}

cberg_status cberg_engine_get_graph_stats(cberg_engine *eng, const char *repo_key, cberg_engine_graph_stats *out) {
    if (eng == NULL || out == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    memset(out, 0, sizeof(*out));
    out->enabled = eng->graph_enabled;
    if (!eng->graph_enabled) {
        return CBERG_ERR_NOT_IMPLEMENTED;
    }
    cberg_repo *r = NULL;
    cberg_status st = graph_repo(eng, repo_key, &r);
    if (st != CBERG_OK) {
        return st;
    }
    pthread_mutex_lock(&r->mu);
    out->repo = r->key;
    out->enabled = r->graph != NULL;
    if (r->graph != NULL) {
        cberg_graph_counts(r->graph, &out->nodes, &out->refs);
        /* Language mix from FILE node path extensions. */
        if (out->nodes > 0) {
            const cberg_graph_node **files = calloc(out->nodes, sizeof(*files));
            if (files != NULL) {
                size_t nfiles = 0;
                if (cberg_graph_find_nodes(r->graph, NULL, CBERG_GNODE_MASK(CBERG_GNODE_FILE), NULL, files, out->nodes, &nfiles) ==
                    CBERG_OK) {
                    for (size_t i = 0; i < nfiles; i++) {
                        const char *path = files[i]->qname != NULL ? files[i]->qname : files[i]->path;
                        bump_lang(out, lang_name(cberg_language_from_path(path)));
                    }
                }
                free(files);
            }
        }
    }
    pthread_mutex_unlock(&r->mu);
    return CBERG_OK;
}

cberg_status cberg_engine_graph_hubs(cberg_engine *eng, const char *repo_key, size_t limit, cberg_engine_graph_hub *out, size_t cap, size_t *found) {
    if (eng == NULL || out == NULL || found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *found = 0;
    cberg_repo *r = NULL;
    cberg_status st = graph_repo(eng, repo_key, &r);
    if (st != CBERG_OK) {
        return st;
    }
    if (limit == 0) {
        limit = 10;
    }
    if (limit > cap) {
        limit = cap;
    }

    pthread_mutex_lock(&r->mu);
    if (!r->ready || r->graph == NULL) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }

    cberg_graph_hub hubs[64];
    size_t n = 0;
    size_t want = limit > 64 ? 64 : limit;
    st = cberg_graph_hubs(r->graph, hubs, want, &n);
    if (st == CBERG_OK) {
        for (size_t i = 0; i < n; i++) {
            const cberg_graph_node *node = cberg_graph_node_by_id(r->graph, hubs[i].id);
            if (node == NULL) {
                continue;
            }
            fill_engine_gnode(&out[*found].node, r->key, node);
            out[*found].degree = hubs[i].degree;
            (*found)++;
        }
    }
    pthread_mutex_unlock(&r->mu);
    return st;
}

cberg_status cberg_engine_graph_references(cberg_engine *eng, const char *name, const char *repo_key, const char *path_prefix, size_t limit, cberg_engine_graph_edge *out, size_t cap, size_t *found) {
    if (eng == NULL || name == NULL || name[0] == '\0' || out == NULL || found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *found = 0;
    cberg_repo *r = NULL;
    cberg_status st = graph_repo(eng, repo_key, &r);
    if (st != CBERG_OK) {
        return st;
    }
    if (limit == 0) {
        limit = 50;
    }
    if (limit > cap) {
        limit = cap;
    }

    pthread_mutex_lock(&r->mu);
    if (!r->ready || r->graph == NULL) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }

    const char *path_filter = (path_prefix != NULL && path_prefix[0] != '\0') ? path_prefix : NULL;
    const cberg_graph_node *nodes[64];
    size_t n_nodes = 0;
    st = cberg_graph_find_nodes(r->graph, name, 0, path_filter, nodes, 64, &n_nodes);
    if (st != CBERG_OK || n_nodes == 0) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    /* Prefer an exact path match when path_prefix is a full file path. */
    if (path_filter != NULL && n_nodes > 1) {
        size_t exact = 0;
        const cberg_graph_node *picked[64];
        for (size_t i = 0; i < n_nodes; i++) {
            if (nodes[i]->path != NULL && strcmp(nodes[i]->path, path_filter) == 0) {
                picked[exact++] = nodes[i];
            }
        }
        if (exact > 0) {
            for (size_t i = 0; i < exact; i++) {
                nodes[i] = picked[i];
            }
            n_nodes = exact;
        }
    }

    /* REFERENCES is reserved / not extracted yet — omit from the live mask. */
    uint32_t kind_mask = CBERG_GEDGE_CALLS | CBERG_GEDGE_INHERITS | CBERG_GEDGE_IMPORTS;
    size_t written = 0;
    for (size_t i = 0; i < n_nodes && written < limit; i++) {
        cberg_graph_edge edges[64];
        size_t n_edges = 0;
        st = cberg_graph_edges_to(r->graph, nodes[i]->id, kind_mask, edges, 64, &n_edges);
        if (st != CBERG_OK) {
            continue;
        }
        for (size_t e = 0; e < n_edges && written < limit; e++) {
            fill_engine_gedge(&out[written], r->graph, &edges[e]);
            written++;
        }
    }
    *found = written;
    pthread_mutex_unlock(&r->mu);
    return CBERG_OK;
}
