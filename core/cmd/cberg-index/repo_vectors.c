#define _POSIX_C_SOURCE 200809L

#include "indexer_internal.h"

#include "chunk_table_internal.h"
#include "fileio.h"
#include "u64map.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define EMBED_WINDOW 1024 /* chunks read and length-sorted together before embedding */
#define EMBED_CALL 96     /* max chunks per embedder call, i.e. per embed_mu hold */
/* Inference cost grows with tokens, and the 256-token model window fills at
 * about 1 KiB of code, so a call is also capped at 32 full-window bodies. */
#define EMBED_TEXT_COST_MAX 1024
#define EMBED_CALL_BUDGET (32 * EMBED_TEXT_COST_MAX)
#define PROGRESS_MIN 128  /* only show embed progress for upserts at least this large */
#define PROGRESS_STEP 512 /* ...and roughly every this many chunks */

static char *chunk_body(const cberg_repo *r, const cberg_stored_chunk *sc, size_t *out_len) {
    char path[4096];
    snprintf(path, sizeof(path), "%s/%s", r->root, sc->chunk.path);
    return cberg_read_file(path, out_len);
}

/* Cache file bodies across contiguous same-path chunks during embed. */
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

/* Drop every body except the most recent one, so a file whose chunks straddle
 * an embed batch boundary is still read only once. */
static void file_cache_keep_last(file_cache *fc) {
    if (fc->len <= 1) {
        return;
    }

    for (size_t i = 0; i + 1 < fc->len; i++) {
        free(fc->items[i].data);
    }

    fc->items[0] = fc->items[fc->len - 1];
    fc->len = 1;
}

/* Slice sc's body from the file cache, reading the file on path change. */
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

/* Receives the vector for item `item` (an index into the rows handed to
 * embed_window). The vector is only valid for the duration of the call. */
typedef cberg_status (*embed_sink)(void *ctx, size_t item, const float *vec);

typedef struct {
    size_t len;
    size_t item;
} sized_item;

static int sized_item_cmp(const void *a, const void *b) {
    const sized_item *x = a;
    const sized_item *y = b;

    if (x->len != y->len) {
        return x->len < y->len ? -1 : 1;
    }
    return x->item < y->item ? -1 : x->item > y->item;
}

static void free_texts(char **texts, size_t n) {
    for (size_t i = 0; i < n; i++) {
        free(texts[i]);
    }
    free(texts);
}

/* Copy each row's body out of the file cache, so the window holds only the
 * bytes it embeds rather than every whole file it touched. */
static cberg_status read_window(cberg_repo *r, const cberg_stored_chunk *const *rows, size_t n, char **texts, sized_item *items) {
    file_cache fc = {0};
    cberg_status st = CBERG_OK;

    for (size_t i = 0; i < n && st == CBERG_OK; i++) {
        const char *text = NULL;
        size_t len = 0;

        st = cache_slice(r, &fc, rows[i], &text, &len);
        if (st != CBERG_OK) {
            break;
        }

        texts[i] = malloc(len > 0 ? len : 1);
        if (texts[i] == NULL) {
            st = CBERG_ERR_OUT_OF_MEMORY;
            break;
        }
        memcpy(texts[i], text, len);

        items[i].len = len;
        items[i].item = i;
        file_cache_keep_last(&fc);
    }

    file_cache_free(&fc);
    return st;
}

/* How many sorted items starting at items[0] fit one call: at most EMBED_CALL
 * and at most EMBED_CALL_BUDGET bytes of (window-clamped) text, but never 0. */
static size_t call_len(const sized_item *items, size_t n) {
    size_t budget = 0;
    size_t bn = 0;

    while (bn < n && bn < EMBED_CALL) {
        size_t cost = items[bn].len < EMBED_TEXT_COST_MAX ? items[bn].len : EMBED_TEXT_COST_MAX;
        if (bn > 0 && budget + cost > EMBED_CALL_BUDGET) {
            break;
        }

        budget += cost;
        bn++;
    }
    return bn;
}

/*
 * Embed rows[0..n) (n <= EMBED_WINDOW) shortest-first in bounded calls.
 * Batched transformer cost tracks each batch's longest text, so sorting the
 * whole window by length keeps padding low, while capping each call by count
 * and by text volume keeps every embed_mu hold short enough that interactive
 * searches are not starved, even for the window's longest bodies. Byte length
 * is a close proxy for token count and needs no tokenizer here.
 */
static cberg_status embed_window(cberg_repo *r, const cberg_stored_chunk *const *rows, size_t n, embed_sink sink, void *ctx) {
    size_t dim = r->eng->embed_dim;
    char **texts = calloc(n, sizeof(*texts));
    sized_item *items = malloc(n * sizeof(*items));
    const char *btexts[EMBED_CALL];
    size_t blens[EMBED_CALL];

    cberg_status st = CBERG_ERR_OUT_OF_MEMORY;
    if (texts == NULL || items == NULL) {
        goto done;
    }

    st = read_window(r, rows, n, texts, items);
    if (st != CBERG_OK) {
        goto done;
    }
    qsort(items, n, sizeof(*items), sized_item_cmp);

    for (size_t c = 0, bn = 0; c < n && st == CBERG_OK; c += bn) {
        bn = call_len(items + c, n - c);
        for (size_t b = 0; b < bn; b++) {
            btexts[b] = texts[items[c + b].item];
            blens[b] = items[c + b].len;
        }

        float *vecs = NULL;
        st = cberg_engine_embed(r->eng, btexts, blens, bn, 0, &vecs);
        for (size_t b = 0; b < bn && st == CBERG_OK; b++) {
            st = sink(ctx, items[c + b].item, vecs + b * dim);
        }
        cberg_vectors_free(vecs);
    }

done:
    if (texts != NULL) {
        free_texts(texts, n);
    }
    free(items);
    return st;
}

typedef struct {
    cberg_repo *repo;
    cberg_index *index;
    const cberg_stored_chunk *const *rows;
    const size_t *group_start;
    const size_t *members;
    size_t base; /* group index of the window's first representative */
    int show;
    size_t *done;
    size_t total;
    size_t mark;
} unique_sink;

/* Fan one representative's vector out to every chunk sharing its body. */
static cberg_status add_group_vector(void *v, size_t item, const float *vec) {
    unique_sink *u = v;
    size_t k = u->base + item;

    for (size_t m = u->group_start[k]; m < u->group_start[k + 1]; m++) {
        cberg_status st = cberg_index_add(u->index, u->rows[u->members[m]]->id, vec);
        if (st != CBERG_OK) {
            return st;
        }

        (*u->done)++;
        atomic_fetch_add(&u->repo->progress_completed, 1);
        if (u->show && (*u->done >= u->mark || *u->done == u->total)) {
            fprintf(stderr, "cberg-index[%s]: embedded %zu/%zu chunks (%zu%%)\n", u->repo->key, *u->done, u->total, *u->done * 100 / u->total);
            u->mark += PROGRESS_STEP;
        }
    }
    return CBERG_OK;
}

/*
 * Embed unique bodies only (keyed by content_hash; full-hash confirm after 8-byte
 * map key). Duplicates reuse the representative vector. Grouping needs only
 * hashes, so bodies are read per embed window (representatives only) and
 * released once embedded rather than held for the whole upsert.
 */
static cberg_status embed_unique(cberg_repo *r, cberg_index *index, const cberg_stored_chunk *const *rows, size_t count, int show, size_t *done, size_t total, size_t *out_unique) {
    if (out_unique != NULL) {
        *out_unique = 0;
    }
    if (count == 0) {
        return CBERG_OK;
    }
    cberg_u64map *seen = cberg_u64map_new(count * 2);
    size_t *reps = malloc(count * sizeof(*reps));         /* group -> a representative item index */
    size_t *group_of = malloc(count * sizeof(*group_of)); /* item -> its group index */
    size_t *group_start = NULL;
    size_t *members = NULL;
    size_t *cursor = NULL;
    const cberg_stored_chunk **wrows = NULL;
    cberg_status st = CBERG_ERR_OUT_OF_MEMORY;
    if (seen == NULL || reps == NULL || group_of == NULL) {
        goto done;
    }

    /* Pass 1: assign each item to a group keyed by its body. A 64-bit hash-prefix hit
     * is confirmed against the full hash; a mismatch (collision) or an all-zero prefix
     * (the map reserves key 0) just starts its own group. The map records only the
     * first group for a prefix, so a collision leaves the original mapping intact. */
    size_t n_groups = 0;
    for (size_t u = 0; u < count; u++) {
        const uint8_t *hash = rows[u]->chunk.content_hash;
        uint64_t key;
        memcpy(&key, hash, sizeof(key));
        uint64_t hit = 0;
        int found = key != 0 && cberg_u64map_get(seen, key, &hit);
        if (found && memcmp(hash, rows[reps[hit]]->chunk.content_hash, CBERG_HASH_LEN) == 0) {
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
     * contiguous in `members`, letting each embed window be freed before the next. */
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

    unique_sink sink = {
        .repo = r,
        .index = index,
        .rows = rows,
        .group_start = group_start,
        .members = members,
        .show = show,
        .done = done,
        .total = total,
        .mark = (*done / PROGRESS_STEP + 1) * PROGRESS_STEP,
    };

    size_t wcap = n_groups < EMBED_WINDOW ? n_groups : EMBED_WINDOW;
    wrows = malloc(wcap * sizeof(*wrows));
    if (wrows == NULL) {
        st = CBERG_ERR_OUT_OF_MEMORY;
        goto done;
    }

    st = CBERG_OK;
    for (size_t g = 0; g < n_groups && st == CBERG_OK; g += EMBED_WINDOW) {
        size_t wn = n_groups - g < EMBED_WINDOW ? n_groups - g : EMBED_WINDOW;
        for (size_t b = 0; b < wn; b++) {
            wrows[b] = rows[reps[g + b]];
        }

        sink.base = g;
        st = embed_window(r, wrows, wn, add_group_vector, &sink);
    }
    if (st == CBERG_OK && out_unique != NULL) {
        *out_unique = n_groups;
    }

done:
    cberg_u64map_free(seen);
    free(reps);
    free(group_of);
    free(group_start);
    free(members);
    free(cursor);
    free(wrows);
    return st;
}

static cberg_status apply_vectors(cberg_repo *r, const cberg_changes *ch) {
    size_t total = cberg_chunk_table_len(r->table);
    size_t upsert_len = ch->added_len + ch->modified_len;
    repo_progress_begin(r, "embedding", total, total >= upsert_len ? total - upsert_len : 0);

    if (!r->eng->vectors || r->index == NULL) {
        atomic_store(&r->progress_completed, total);
        return CBERG_OK;
    }

    if (upsert_len == 0 && ch->deleted_len == 0) {
        return cberg_index_save(r->index);
    }

    const cberg_stored_chunk **rows = NULL;
    cberg_status st = CBERG_OK;

    if (upsert_len > 0) {
        rows = calloc(upsert_len, sizeof(*rows));
        if (rows == NULL) {
            st = CBERG_ERR_OUT_OF_MEMORY;
            goto done;
        }

        size_t u = 0;
        for (size_t i = 0; i < ch->added_len; i++) {
            rows[u++] = &ch->added[i];
        }
        for (size_t i = 0; i < ch->modified_len; i++) {
            rows[u++] = &ch->modified[i];
        }

        /* Embed unique bodies only: code upserts carry many byte-identical chunks
         * (license headers, generated code, trivial accessors), and identical text
         * maps to an identical vector, so embedding one and reusing it is exact. */
        int show = upsert_len >= PROGRESS_MIN;
        size_t done_n = 0;
        size_t unique = 0;
        st = embed_unique(r, r->index, rows, upsert_len, show, &done_n, upsert_len, &unique);
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
    free(rows);
    return st;
}

static cberg_status rebuild_index(cberg_repo *r);

static int vector_status_retriable(cberg_status st) {
    return st == CBERG_ERR_IO || st == CBERG_ERR_TIMEOUT || st == CBERG_ERR_INTERNAL;
}

static void vector_retry_backoff(int attempt) {
    long ms = 100L * (attempt + 1);
    struct timespec delay = {.tv_sec = ms / 1000, .tv_nsec = (ms % 1000) * 1000000L};

    nanosleep(&delay, NULL);
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

/* Embed every chunk in the table into `target`, reusing vectors across
 * identical bodies exactly like an incremental upsert. Caller holds r->mu. */
static cberg_status embed_table(cberg_repo *r, cberg_index *target) {
    size_t n = cberg_chunk_table_len(r->table);
    if (n == 0) {
        return CBERG_OK;
    }

    const cberg_stored_chunk **rows = malloc(n * sizeof(*rows));
    if (rows == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    size_t count = 0;
    for (size_t i = 0; i < n; i++) {
        const cberg_stored_chunk *sc = cberg_chunk_table_at(r->table, i);
        if (sc != NULL) {
            rows[count++] = sc;
        }
    }

    size_t done = 0;
    int show = count >= PROGRESS_MIN;
    repo_progress_begin(r, "embedding", count, 0);
    cberg_status st = embed_unique(r, target, rows, count, show, &done, count, NULL);

    free(rows);
    return st;
}

static cberg_status rebuild_index(cberg_repo *r) {
    if (!r->eng->vectors || r->index == NULL) {
        return CBERG_OK;
    }

    size_t dim = r->eng->embed_dim;
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

    cberg_status fill = embed_table(r, target);
    if (fill != CBERG_OK) {
        if (temp_idx != NULL) {
            cberg_index_close(temp_idx);
            unlink(temp);
        }
        return fill;
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

cberg_status repo_sync_vectors(cberg_repo *r, const cberg_changes *ch) {
    cberg_status st = with_vector_retry(r, "vector apply", apply_vectors_op, (void *)ch);
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
    repo_progress_begin(r, "finalizing", cberg_chunk_table_len(r->table), cberg_chunk_table_len(r->table));

    /* Live per-sync line for the watch loop; bootstrap reports via embed progress
     * and the final "bootstrap complete" count instead. */
    if (r->ready && (ch->added_len != 0 || ch->modified_len != 0 || ch->deleted_len != 0)) {
        fprintf(stderr, "cberg-index[%s]: indexed +%zu ~%zu -%zu (%zu chunks)\n", r->key, ch->added_len, ch->modified_len, ch->deleted_len, cberg_chunk_table_len(r->table));
    }
    return CBERG_OK;
}
