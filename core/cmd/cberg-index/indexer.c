#define _POSIX_C_SOURCE 200809L

#include "indexer.h"
#include "walk.h"

#include "fileio.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define BATCH_SIZE 32
#define PROGRESS_MIN 128  /* only show embed progress for upserts at least this large */
#define PROGRESS_STEP 512 /* ...and roughly every this many chunks */

static void save_chunk_table(cberg_indexer *idx);
static void save_state(cberg_indexer *idx);
static void refresh_manifest(cberg_indexer *idx);
static cberg_status apply_path_changes(cberg_indexer *idx, char **rechunk, size_t rechunk_n, char **deleted,
                                       size_t deleted_n);
static cberg_status walk_and_sync(cberg_indexer *idx);
static cberg_status bootstrap_warm(cberg_indexer *idx);

typedef struct {
    cberg_chunk *items;
    size_t len;
    size_t cap;
    cberg_chunk_list **lists;
    size_t lists_len;
    size_t lists_cap;
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

static char *chunk_body(const cberg_indexer *idx, const cberg_stored_chunk *sc, size_t *out_len) {
    char path[4096];
    snprintf(path, sizeof(path), "%s/%s", idx->root, sc->chunk.path);
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
static cberg_status cache_slice(cberg_indexer *idx, file_cache *fc, const cberg_stored_chunk *sc, const char **text,
                                size_t *len) {
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
        char *data = chunk_body(idx, sc, &blen);
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

static cberg_status apply_vectors(cberg_indexer *idx, const cberg_changes *ch) {
    if (!idx->vectors || idx->embedder == NULL || idx->index == NULL) {
        return CBERG_OK;
    }

    size_t upsert_len = ch->added_len + ch->modified_len;
    if (upsert_len == 0 && ch->deleted_len == 0) {
        return cberg_index_save(idx->index);
    }

    const char **texts = NULL;
    size_t *lens = NULL;
    uint64_t *ids = NULL;
    file_cache fc = {0};
    cberg_status st = CBERG_OK;

    if (upsert_len > 0) {
        texts = calloc(upsert_len, sizeof(*texts));
        lens = calloc(upsert_len, sizeof(*lens));
        ids = calloc(upsert_len, sizeof(*ids));
        if (texts == NULL || lens == NULL || ids == NULL) {
            st = CBERG_ERR_OUT_OF_MEMORY;
            goto done;
        }
        size_t u = 0;
        for (size_t i = 0; i < ch->added_len; i++) {
            st = cache_slice(idx, &fc, &ch->added[i], &texts[u], &lens[u]);
            if (st != CBERG_OK) {
                goto done;
            }
            ids[u] = ch->added[i].id;
            u++;
        }
        for (size_t i = 0; i < ch->modified_len; i++) {
            st = cache_slice(idx, &fc, &ch->modified[i], &texts[u], &lens[u]);
            if (st != CBERG_OK) {
                goto done;
            }
            ids[u] = ch->modified[i].id;
            u++;
        }

        size_t dim = cberg_embedder_dim(idx->embedder);
        int show = upsert_len >= PROGRESS_MIN;
        size_t mark = PROGRESS_STEP;
        for (size_t off = 0; off < upsert_len;) {
            size_t bn = upsert_len - off;
            if (bn > BATCH_SIZE) {
                bn = BATCH_SIZE;
            }
            float *vecs = NULL;
            st = cberg_embedder_embed(idx->embedder, texts + off, lens + off, bn, &vecs);
            if (st != CBERG_OK) {
                cberg_vectors_free(vecs);
                goto done;
            }
            for (size_t i = 0; i < bn; i++) {
                st = cberg_index_add(idx->index, ids[off + i], vecs + i * dim);
                if (st != CBERG_OK) {
                    cberg_vectors_free(vecs);
                    goto done;
                }
            }
            cberg_vectors_free(vecs);
            off += bn;
            if (show && (off >= mark || off == upsert_len)) {
                fprintf(stderr, "cberg-index: embedded %zu/%zu chunks (%zu%%)\n", off, upsert_len,
                        off * 100 / upsert_len);
                mark += PROGRESS_STEP;
            }
        }
    }

    int del_show = ch->deleted_len >= PROGRESS_MIN;
    size_t del_mark = PROGRESS_STEP;
    for (size_t i = 0; i < ch->deleted_len; i++) {
        st = cberg_index_remove(idx->index, ch->deleted[i].id);
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
            fprintf(stderr, "cberg-index: removed %zu/%zu chunks (%zu%%)\n", i + 1, ch->deleted_len,
                    (i + 1) * 100 / ch->deleted_len);
            del_mark += PROGRESS_STEP;
        }
    }

    st = cberg_index_save(idx->index);

done:
    file_cache_free(&fc);
    free(ids);
    free(lens);
    free(texts);
    return st;
}

static cberg_status rebuild_index(cberg_indexer *idx) {
    if (!idx->vectors || idx->embedder == NULL || idx->index == NULL) {
        return CBERG_OK;
    }

    char temp[4096];
    snprintf(temp, sizeof(temp), "%s.rebuild", idx->index_path);
    unlink(temp);

    size_t dim = cberg_embedder_dim(idx->embedder);
    cberg_index *temp_idx = NULL;
    cberg_status st = cberg_index_open(temp, dim, NULL, &temp_idx);
    if (st != CBERG_OK) {
        return st;
    }

    size_t n = cberg_chunk_table_len(idx->table);
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
        if (texts == NULL || lens == NULL || ids == NULL) {
            st = CBERG_ERR_OUT_OF_MEMORY;
            free(texts);
            free(lens);
            free(ids);
            cberg_index_close(temp_idx);
            unlink(temp);
            return st;
        }
        for (size_t j = i; j < end; j++) {
            const cberg_stored_chunk *sc = cberg_chunk_table_at(idx->table, j);
            if (sc == NULL) {
                continue;
            }
            st = cache_slice(idx, &fc, sc, &texts[count], &lens[count]);
            if (st != CBERG_OK) {
                file_cache_free(&fc);
                free(texts);
                free(lens);
                free(ids);
                cberg_index_close(temp_idx);
                unlink(temp);
                return st;
            }
            ids[count] = sc->id;
            count++;
        }
        if (count > 0) {
            float *vecs = NULL;
            st = cberg_embedder_embed(idx->embedder, texts, lens, count, &vecs);
            file_cache_free(&fc);
            free(texts);
            free(lens);
            if (st != CBERG_OK) {
                free(ids);
                cberg_index_close(temp_idx);
                unlink(temp);
                return st;
            }
            for (size_t k = 0; k < count; k++) {
                st = cberg_index_add(temp_idx, ids[k], vecs + k * dim);
                if (st != CBERG_OK) {
                    cberg_vectors_free(vecs);
                    free(ids);
                    cberg_index_close(temp_idx);
                    unlink(temp);
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

    st = cberg_index_save(temp_idx);
    cberg_index_close(temp_idx);
    if (st != CBERG_OK) {
        unlink(temp);
        return st;
    }

    cberg_index_close(idx->index);
    idx->index = NULL;
    if (rename(temp, idx->index_path) != 0) {
        st = CBERG_ERR_IO;
        cberg_index_open(idx->index_path, dim, NULL, &idx->index);
        return st;
    }
    return cberg_index_open(idx->index_path, dim, NULL, &idx->index);
}

static cberg_status sync_table(cberg_indexer *idx, chunk_batch *batch) {
    cberg_changes ch = {0};
    cberg_status st = cberg_chunk_table_sync(idx->table, batch->items, batch->len, &ch);
    if (st != CBERG_OK) {
        return st;
    }
    st = apply_vectors(idx, &ch);
    if (st != CBERG_OK) {
        idx->ready = 0;
        cberg_status r = rebuild_index(idx);
        if (r != CBERG_OK) {
            return r;
        }
        idx->ready = 1;
    }
    /* Live per-sync line for the watch loop; bootstrap reports via embed progress
     * and the final "bootstrap complete" count instead. */
    if (idx->ready && (ch.added_len != 0 || ch.modified_len != 0 || ch.deleted_len != 0)) {
        fprintf(stderr, "cberg-index: indexed +%zu ~%zu -%zu (%zu chunks)\n", ch.added_len, ch.modified_len,
                ch.deleted_len, cberg_chunk_table_len(idx->table));
    }
    return CBERG_OK;
}

static cberg_status parse_file(cberg_indexer *idx, const char *abs, const char *rel, cberg_chunk_list **out) {
    *out = NULL;
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
    cberg_status st = cberg_chunker_parse(idx->chunker, lang, rel, data, len, &list);
    if (st != CBERG_OK) {
        free(data);
        return st;
    }
    if (list != NULL) {
        st = cberg_chunk_list_hash_bodies(list, data, len);
        if (st != CBERG_OK) {
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
    cberg_indexer *idx;
    chunk_batch *batch;
    cberg_status err;
    size_t files;
} walk_ctx;

static int bootstrap_cb(const char *abs, const char *rel, void *v) {
    walk_ctx *ctx = v;
    if (++ctx->files % 1000 == 0) {
        fprintf(stderr, "cberg-index: scanned %zu files...\n", ctx->files);
    }
    cberg_chunk_list *list = NULL;
    cberg_status st = parse_file(ctx->idx, abs, rel, &list);
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
        ctx->err = st;
        return -1;
    }
    return 0;
}

/* ----------------------------------------------------- state persistence */

static void save_chunk_table(cberg_indexer *idx) {
    if (idx->chunks_path == NULL) {
        return;
    }
    cberg_status st = cberg_chunk_table_save(idx->table, idx->chunks_path);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index: warning: could not persist chunk table: %s\n", cberg_status_str(st));
    }
}

static void save_manifest(cberg_indexer *idx) {
    if (idx->manifest_path == NULL || idx->manifest == NULL) {
        return;
    }
    cberg_status st = cberg_manifest_save(idx->manifest, idx->manifest_path);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index: warning: could not persist manifest: %s\n", cberg_status_str(st));
    }
}

static void save_state(cberg_indexer *idx) {
    save_chunk_table(idx);
    save_manifest(idx);
}

/* Rebuild the manifest baseline from the current on-disk tree (stat-only for
 * unchanged files) so the next restart sees an accurate "what changed while we
 * were down". Failure is non-fatal: the baseline simply stays as it was. */
static void refresh_manifest(cberg_indexer *idx) {
    if (idx->manifest_path == NULL) {
        return;
    }
    cberg_manifest *next = NULL;
    cberg_status st = cberg_manifest_rebuild(idx->manifest, idx->root, &next);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index: warning: could not refresh manifest: %s\n", cberg_status_str(st));
        return;
    }
    cberg_manifest_free(idx->manifest);
    idx->manifest = next;
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

size_t cberg_indexer_chunk_count(cberg_indexer *idx) {
    pthread_mutex_lock(&idx->mu);
    size_t n = cberg_chunk_table_len(idx->table);
    pthread_mutex_unlock(&idx->mu);
    return n;
}

cberg_status cberg_indexer_open(cberg_indexer *idx) {
    memset(idx, 0, sizeof(*idx));
    pthread_mutex_init(&idx->mu, NULL);

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
    idx->root = strdup(resolved);
    if (idx->root == NULL) {
        cberg_indexer_close(idx);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    const char *model = getenv("CBERG_MODEL");
    const char *index_path = getenv("CBERG_INDEX_PATH");
    if (model != NULL && model[0] != '\0' && index_path != NULL && index_path[0] != '\0') {
        idx->vectors = 1;
        idx->model_path = strdup(model);
        if (idx->model_path == NULL) {
            cberg_indexer_close(idx);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        /* CBERG_INDEX_PATH is a base path; the actual index and its chunk-table /
         * manifest sidecars are per-directory ("<base>.<roothash>[.chunks|.manifest]").
         * Pointing at a different tree never reuses another tree's chunks, and
         * reverting to a prior tree finds its embeddings still cached. */
        char tag[18]; /* ".<16 hex>" */
        tag[0] = '.';
        root_suffix(idx->root, tag + 1);
        idx->index_path = join_str(index_path, tag);
        if (idx->index_path == NULL) {
            cberg_indexer_close(idx);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        idx->chunks_path = join_str(idx->index_path, ".chunks");
        idx->manifest_path = join_str(idx->index_path, ".manifest");
        if (idx->chunks_path == NULL || idx->manifest_path == NULL) {
            cberg_indexer_close(idx);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }

    idx->poll_ms = 1000;
    const char *poll = getenv("CBERG_POLL_MS");
    if (poll != NULL && poll[0] != '\0') {
        idx->poll_ms = atoi(poll);
        if (idx->poll_ms < 0) {
            return CBERG_ERR_INVALID_ARGUMENT;
        }
    }
    if (idx->poll_ms <= 0) {
        idx->poll_ms = 1000;
    }

    const char *sock = getenv("CBERG_SOCKET");
    if (sock != NULL && sock[0] != '\0') {
        idx->socket_path = strdup(sock);
    } else {
        idx->socket_path = strdup("/tmp/codeberg-index.sock");
    }
    if (idx->socket_path == NULL) {
        cberg_indexer_close(idx);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = cberg_chunker_open(&idx->chunker);
    if (st != CBERG_OK) {
        cberg_indexer_close(idx);
        return st;
    }
    idx->table = cberg_chunk_table_new();
    if (idx->table == NULL) {
        cberg_indexer_close(idx);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    st = cberg_watcher_open(idx->root, &idx->watcher);
    if (st != CBERG_OK) {
        cberg_indexer_close(idx);
        return st;
    }

    if (idx->vectors) {
        struct stat mst;
        if (stat(idx->model_path, &mst) != 0) {
            fprintf(stderr,
                    "cberg-index: embedding model not found: '%s'\n"
                    "  fetch one with scripts/fetch-model.sh and point CBERG_MODEL at its .onnx,\n"
                    "  or unset CBERG_MODEL and CBERG_INDEX_PATH to run chunk-only.\n",
                    idx->model_path);
            cberg_indexer_close(idx);
            return CBERG_ERR_IO;
        }
        cberg_embed_config ecfg = {0};
        ecfg.provider = CBERG_EMBED_ONNX;
        ecfg.model_path = idx->model_path;
        st = cberg_embedder_open(&ecfg, &idx->embedder);
        if (st != CBERG_OK) {
            fprintf(stderr, "cberg-index: failed to load embedding model '%s': %s\n", idx->model_path,
                    cberg_status_str(st));
            cberg_indexer_close(idx);
            return st;
        }
        size_t dim = cberg_embedder_dim(idx->embedder);
        st = cberg_index_open(idx->index_path, dim, NULL, &idx->index);
        if (st == CBERG_ERR_IO) {
            /* The index file exists but won't load — corrupt, e.g. a save
             * interrupted by a kill. Discard this directory's stale state (index
             * + sidecars) and reindex from scratch rather than failing to start. */
            fprintf(stderr, "cberg-index: vector index '%s' is unreadable; discarding and reindexing\n",
                    idx->index_path);
            remove(idx->index_path);
            remove(idx->chunks_path);
            remove(idx->manifest_path);
            st = cberg_index_open(idx->index_path, dim, NULL, &idx->index);
        }
        if (st != CBERG_OK) {
            fprintf(stderr, "cberg-index: failed to open vector index '%s': %s\n", idx->index_path,
                    cberg_status_str(st));
            cberg_indexer_close(idx);
            return st;
        }
    }

    return CBERG_OK;
}

void cberg_indexer_close(cberg_indexer *idx) {
    if (idx == NULL) {
        return;
    }
    idx->stop = 1;
    /* On a clean shutdown after bootstrap, refresh the baseline so the next start
     * re-chunks nothing it doesn't have to. Skipped on early-open failures (not
     * ready) to avoid overwriting good state with a half-built one. */
    if (idx->ready) {
        refresh_manifest(idx);
        save_state(idx);
    }
    if (idx->index != NULL) {
        cberg_index_save(idx->index);
        cberg_index_close(idx->index);
    }
    if (idx->embedder != NULL) {
        cberg_embedder_close(idx->embedder);
    }
    if (idx->watcher != NULL) {
        cberg_watcher_close(idx->watcher);
    }
    if (idx->manifest != NULL) {
        cberg_manifest_free(idx->manifest);
    }
    if (idx->table != NULL) {
        cberg_chunk_table_free(idx->table);
    }
    if (idx->chunker != NULL) {
        cberg_chunker_close(idx->chunker);
    }
    free(idx->root);
    free(idx->model_path);
    free(idx->index_path);
    free(idx->chunks_path);
    free(idx->manifest_path);
    free(idx->socket_path);
    pthread_mutex_destroy(&idx->mu);
    memset(idx, 0, sizeof(*idx));
}

/* Walk every file, chunk it, and capture a manifest baseline for next time. The
 * caller holds idx->mu. Used both on a true cold start (empty table) and as the
 * fallback when a chunk table was restored but no manifest was: in the latter
 * case unchanged chunks still keep their ids, so sync re-embeds nothing. */
static cberg_status walk_and_sync(cberg_indexer *idx) {
    chunk_batch batch;
    batch_init(&batch);
    walk_ctx ctx = {.idx = idx, .batch = &batch};
    if (cberg_walk_files(idx->root, bootstrap_cb, &ctx) != 0) {
        batch_reset(&batch);
        return ctx.err != CBERG_OK ? ctx.err : CBERG_ERR_IO;
    }
    cberg_status st = sync_table(idx, &batch);
    batch_reset(&batch);
    if (st != CBERG_OK) {
        return st;
    }
    if (idx->manifest_path != NULL) {
        cberg_manifest *m = NULL;
        if (cberg_manifest_build(idx->root, &m) == CBERG_OK) {
            cberg_manifest_free(idx->manifest);
            idx->manifest = m;
        } else {
            fprintf(stderr, "cberg-index: warning: manifest build failed; restarts will re-scan all files\n");
        }
    }
    return CBERG_OK;
}

cberg_status cberg_indexer_bootstrap(cberg_indexer *idx) {
    pthread_mutex_lock(&idx->mu);

    /* Warm path first: when a prior chunk table is on disk, reuse it so unchanged
     * chunks keep their ids (and embeddings). NOT_FOUND means there is no prior
     * state, so fall through to a cold build. */
    cberg_status st = CBERG_ERR_NOT_FOUND;
    if (idx->chunks_path != NULL) {
        st = bootstrap_warm(idx);
        if (st != CBERG_ERR_NOT_FOUND) {
            if (st == CBERG_OK) {
                idx->ready = 1;
            }
            pthread_mutex_unlock(&idx->mu);
            return st;
        }
    }

    st = walk_and_sync(idx);
    if (st == CBERG_OK) {
        idx->ready = 1;
        save_state(idx);
    }
    pthread_mutex_unlock(&idx->mu);
    return st;
}

static cberg_status batch_add_table_except(cberg_indexer *idx, chunk_batch *batch, char **skip, size_t skip_n) {
    size_t n = cberg_chunk_table_len(idx->table);
    for (size_t i = 0; i < n; i++) {
        const cberg_stored_chunk *sc = cberg_chunk_table_at(idx->table, i);
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
 * re-embedded. The path arrays are borrowed (not freed). Caller holds idx->mu. */
static cberg_status apply_path_changes(cberg_indexer *idx, char **rechunk, size_t rechunk_n, char **deleted,
                                       size_t deleted_n) {
    chunk_batch batch;
    batch_init(&batch);

    char **skip = NULL;
    size_t skip_n = 0;
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

    cberg_status st = batch_add_table_except(idx, &batch, skip, skip_n);
    if (st != CBERG_OK) {
        goto done;
    }

    for (size_t i = 0; i < rechunk_n; i++) {
        char abs[4096];
        snprintf(abs, sizeof(abs), "%s/%s", idx->root, rechunk[i]);
        cberg_chunk_list *list = NULL;
        st = parse_file(idx, abs, rechunk[i], &list);
        if (st != CBERG_OK) {
            goto done;
        }
        if (list != NULL) {
            st = batch_add_list(&batch, list);
            if (st != CBERG_OK) {
                cberg_chunk_list_free(list);
                goto done;
            }
        }
    }

    st = sync_table(idx, &batch);

done:
    batch_reset(&batch);
    free(skip);
    return st;
}

static cberg_status bootstrap_warm(cberg_indexer *idx) {
    cberg_chunk_table *restored = NULL;
    cberg_status st = cberg_chunk_table_load(idx->chunks_path, &restored);
    if (st != CBERG_OK) {
        return st; /* NOT_FOUND -> cold start; a real error propagates */
    }
    cberg_chunk_table_free(idx->table);
    idx->table = restored;

    cberg_manifest *prev = NULL;
    if (idx->manifest_path != NULL && cberg_manifest_load(idx->manifest_path, &prev) != CBERG_OK) {
        prev = NULL;
    }

    /* Chunk table but no manifest baseline: we still avoid re-embedding (ids were
     * restored), but must walk + re-chunk every file to learn what changed. */
    if (prev == NULL) {
        st = walk_and_sync(idx);
        if (st == CBERG_OK) {
            save_state(idx);
        }
        return st;
    }

    /* Manifest-driven: diff the saved tree against a fresh rebuild (stat-only for
     * unchanged files) and re-chunk only added/modified, dropping deleted. */
    cberg_manifest *next = NULL;
    st = cberg_manifest_rebuild(prev, idx->root, &next);
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
        size_t r = 0;
        for (size_t i = 0; i < diff.added_len; i++) {
            rechunk[r++] = (char *)diff.added[i];
        }
        for (size_t i = 0; i < diff.modified_len; i++) {
            rechunk[r++] = (char *)diff.modified[i];
        }
    }

    /* diff paths borrow from prev/next; consume them before either is freed. */
    st = apply_path_changes(idx, rechunk, rechunk_n, (char **)diff.deleted, diff.deleted_len);
    free(rechunk);
    if (st == CBERG_OK) {
        fprintf(stderr, "cberg-index: warm restart: %zu added, %zu modified, %zu deleted since last run\n",
                diff.added_len, diff.modified_len, diff.deleted_len);
    }
    cberg_manifest_diff_free(&diff);
    cberg_manifest_free(prev);
    if (st != CBERG_OK) {
        cberg_manifest_free(next);
        return st;
    }

    cberg_manifest_free(idx->manifest);
    idx->manifest = next; /* the fresh tree becomes the new baseline */
    save_state(idx);
    return CBERG_OK;
}

cberg_status cberg_indexer_run(cberg_indexer *idx) {
    for (;;) {
        if (idx->stop) {
            return CBERG_OK;
        }

        cberg_watch_event events[256];
        size_t count = 0;
        cberg_status st = cberg_watcher_poll(idx->watcher, events, 256, &count, idx->poll_ms);
        if (st == CBERG_ERR_TIMEOUT) {
            continue;
        }
        if (st != CBERG_OK) {
            return st;
        }
        if (count == 0) {
            continue;
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

        pthread_mutex_lock(&idx->mu);
        st = apply_path_changes(idx, rechunk, rechunk_n, deleted, deleted_n);
        if (st == CBERG_OK) {
            /* Persist the chunk table every sync so a restart never re-embeds the
             * work done this session. The manifest baseline is refreshed on close. */
            save_chunk_table(idx);
        }
        pthread_mutex_unlock(&idx->mu);

        for (size_t i = 0; i < rechunk_n; i++) {
            free(rechunk[i]);
        }
        for (size_t i = 0; i < deleted_n; i++) {
            free(deleted[i]);
        }
        free(rechunk);
        free(deleted);

        if (st != CBERG_OK) {
            return st;
        }
    }
}

cberg_status cberg_indexer_search(cberg_indexer *idx, const char *query, size_t k, uint64_t *ids, float *scores,
                                  size_t *found) {
    pthread_mutex_lock(&idx->mu);
    if (!idx->ready) {
        pthread_mutex_unlock(&idx->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    if (!idx->vectors || idx->embedder == NULL || idx->index == NULL) {
        pthread_mutex_unlock(&idx->mu);
        return CBERG_ERR_NOT_IMPLEMENTED;
    }
    cberg_status st =
        cberg_search_query(idx->embedder, idx->index, query, strlen(query), NULL, k, ids, scores, found);
    pthread_mutex_unlock(&idx->mu);
    return st;
}

static const cberg_stored_chunk *find_chunk_by_id(cberg_indexer *idx, uint64_t id) {
    return cberg_chunk_table_find_by_id(idx->table, id);
}

static void fill_snippet(cberg_indexer *idx, const cberg_stored_chunk *sc, char *out, size_t cap) {
    out[0] = '\0';
    if (sc == NULL || cap == 0) {
        return;
    }
    size_t blen = 0;
    char *body = chunk_body(idx, sc, &blen);
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

cberg_status cberg_indexer_search_hits(cberg_indexer *idx, const char *query, size_t k, cberg_search_hit *hits,
                                       size_t cap, size_t *found) {
    if (hits == NULL || found == NULL) {
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

    pthread_mutex_lock(&idx->mu);
    if (!idx->ready) {
        pthread_mutex_unlock(&idx->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    if (!idx->vectors || idx->embedder == NULL || idx->index == NULL) {
        pthread_mutex_unlock(&idx->mu);
        return CBERG_ERR_NOT_IMPLEMENTED;
    }

    uint64_t ids[64];
    float scores[64];
    size_t n = 0;
    cberg_status st =
        cberg_search_query(idx->embedder, idx->index, query, strlen(query), NULL, k, ids, scores, &n);
    if (st != CBERG_OK) {
        pthread_mutex_unlock(&idx->mu);
        return st;
    }

    for (size_t i = 0; i < n && *found < cap; i++) {
        const cberg_stored_chunk *sc = find_chunk_by_id(idx, ids[i]);
        if (sc == NULL) {
            /* Orphaned id: a vector whose chunk is no longer in the table — e.g. a
             * transient leftover from a kill between the index save and the chunk-
             * table save. Skip it rather than emit an empty hit. */
            continue;
        }
        cberg_search_hit *h = &hits[*found];
        h->id = ids[i];
        h->score = scores[i];
        h->path = sc->chunk.path != NULL ? sc->chunk.path : "";
        h->symbol = sc->chunk.symbol != NULL ? sc->chunk.symbol : "";
        h->start_line = sc->chunk.span.start_line;
        h->end_line = sc->chunk.span.end_line;
        h->snippet[0] = '\0';
        fill_snippet(idx, sc, h->snippet, sizeof(h->snippet));
        (*found)++;
    }
    pthread_mutex_unlock(&idx->mu);
    return CBERG_OK;
}
