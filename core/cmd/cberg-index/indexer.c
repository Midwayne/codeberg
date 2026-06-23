#define _POSIX_C_SOURCE 200809L

#include "indexer.h"
#include "walk.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define BATCH_SIZE 32

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

static char *read_file(const char *path, size_t *out_len) {
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return NULL;
    }
    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        return NULL;
    }
    long sz = ftell(f);
    if (sz < 0) {
        fclose(f);
        return NULL;
    }
    if (fseek(f, 0, SEEK_SET) != 0) {
        fclose(f);
        return NULL;
    }
    char *buf = malloc((size_t)sz + 1);
    if (buf == NULL) {
        fclose(f);
        return NULL;
    }
    size_t n = fread(buf, 1, (size_t)sz, f);
    fclose(f);
    buf[n] = '\0';
    *out_len = n;
    return buf;
}

static char *chunk_body(const cberg_indexer *idx, const cberg_stored_chunk *sc, size_t *out_len) {
    char path[4096];
    snprintf(path, sizeof(path), "%s/%s", idx->root, sc->chunk.path);
    return read_file(path, out_len);
}

static cberg_status slice_text(cberg_indexer *idx, const cberg_stored_chunk *sc, const char **text, size_t *len,
                               char **owned) {
    size_t blen = 0;
    *owned = chunk_body(idx, sc, &blen);
    if (*owned == NULL) {
        return CBERG_ERR_IO;
    }
    uint32_t start = sc->chunk.span.start_byte;
    uint32_t end = sc->chunk.span.end_byte;
    if (end > blen || start > end) {
        free(*owned);
        *owned = NULL;
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *text = *owned + start;
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
    char **owned = NULL;
    float *vecs = NULL;
    cberg_status st = CBERG_OK;

    if (upsert_len > 0) {
        texts = calloc(upsert_len, sizeof(*texts));
        lens = calloc(upsert_len, sizeof(*lens));
        ids = calloc(upsert_len, sizeof(*ids));
        owned = calloc(upsert_len, sizeof(*owned));
        if (texts == NULL || lens == NULL || ids == NULL || owned == NULL) {
            st = CBERG_ERR_OUT_OF_MEMORY;
            goto done;
        }
        size_t u = 0;
        for (size_t i = 0; i < ch->added_len; i++) {
            st = slice_text(idx, &ch->added[i], &texts[u], &lens[u], &owned[u]);
            if (st != CBERG_OK) {
                goto done;
            }
            ids[u] = ch->added[i].id;
            u++;
        }
        for (size_t i = 0; i < ch->modified_len; i++) {
            st = slice_text(idx, &ch->modified[i], &texts[u], &lens[u], &owned[u]);
            if (st != CBERG_OK) {
                goto done;
            }
            ids[u] = ch->modified[i].id;
            u++;
        }

        st = cberg_embedder_embed(idx->embedder, texts, lens, upsert_len, &vecs);
        if (st != CBERG_OK) {
            goto done;
        }

        size_t dim = cberg_embedder_dim(idx->embedder);
        for (size_t i = 0; i < upsert_len; i++) {
            st = cberg_index_add(idx->index, ids[i], vecs + i * dim);
            if (st != CBERG_OK) {
                goto done;
            }
        }
    }

    for (size_t i = 0; i < ch->deleted_len; i++) {
        st = cberg_index_remove(idx->index, ch->deleted[i].id);
        if (st != CBERG_OK) {
            goto done;
        }
    }

    st = cberg_index_save(idx->index);

done:
    if (vecs != NULL) {
        cberg_vectors_free(vecs);
    }
    if (owned != NULL) {
        for (size_t i = 0; i < upsert_len; i++) {
            free(owned[i]);
        }
    }
    free(owned);
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
        char **owned = calloc(batch_n, sizeof(*owned));
        size_t count = 0;
        if (texts == NULL || lens == NULL || ids == NULL || owned == NULL) {
            st = CBERG_ERR_OUT_OF_MEMORY;
            free(texts);
            free(lens);
            free(ids);
            free(owned);
            cberg_index_close(temp_idx);
            unlink(temp);
            return st;
        }
        for (size_t j = i; j < end; j++) {
            const cberg_stored_chunk *sc = cberg_chunk_table_at(idx->table, j);
            if (sc == NULL) {
                continue;
            }
            st = slice_text(idx, sc, &texts[count], &lens[count], &owned[count]);
            if (st != CBERG_OK) {
                for (size_t k = 0; k < count; k++) {
                    free(owned[k]);
                }
                free(texts);
                free(lens);
                free(ids);
                free(owned);
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
            for (size_t k = 0; k < count; k++) {
                free(owned[k]);
            }
            free(texts);
            free(lens);
            free(owned);
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
            free(texts);
            free(lens);
            free(ids);
            free(owned);
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
        return CBERG_OK;
    }
    return CBERG_OK;
}

static cberg_status parse_file(cberg_indexer *idx, const char *abs, const char *rel, cberg_chunk_list **out) {
    *out = NULL;
    size_t len = 0;
    char *data = read_file(abs, &len);
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
} walk_ctx;

static int bootstrap_cb(const char *abs, const char *rel, void *v) {
    walk_ctx *ctx = v;
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
        idx->index_path = strdup(index_path);
        if (idx->model_path == NULL || idx->index_path == NULL) {
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
        cberg_embed_config ecfg = {0};
        ecfg.provider = CBERG_EMBED_ONNX;
        ecfg.model_path = idx->model_path;
        st = cberg_embedder_open(&ecfg, &idx->embedder);
        if (st != CBERG_OK) {
            cberg_indexer_close(idx);
            return st;
        }
        size_t dim = cberg_embedder_dim(idx->embedder);
        st = cberg_index_open(idx->index_path, dim, NULL, &idx->index);
        if (st != CBERG_OK) {
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
    if (idx->table != NULL) {
        cberg_chunk_table_free(idx->table);
    }
    if (idx->chunker != NULL) {
        cberg_chunker_close(idx->chunker);
    }
    free(idx->root);
    free(idx->model_path);
    free(idx->index_path);
    free(idx->socket_path);
    pthread_mutex_destroy(&idx->mu);
    memset(idx, 0, sizeof(*idx));
}

cberg_status cberg_indexer_bootstrap(cberg_indexer *idx) {
    pthread_mutex_lock(&idx->mu);
    chunk_batch batch;
    batch_init(&batch);
    walk_ctx ctx = {.idx = idx, .batch = &batch};
    if (cberg_walk_files(idx->root, bootstrap_cb, &ctx) != 0) {
        batch_reset(&batch);
        pthread_mutex_unlock(&idx->mu);
        return ctx.err != CBERG_OK ? ctx.err : CBERG_ERR_IO;
    }
    cberg_status st = sync_table(idx, &batch);
    batch_reset(&batch);
    if (st == CBERG_OK) {
        idx->ready = 1;
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
        chunk_batch batch;
        batch_init(&batch);

        char **skip = calloc(rechunk_n + deleted_n, sizeof(*skip));
        size_t skip_n = 0;
        for (size_t i = 0; i < deleted_n; i++) {
            skip[skip_n++] = deleted[i];
        }
        for (size_t i = 0; i < rechunk_n; i++) {
            skip[skip_n++] = rechunk[i];
        }
        st = batch_add_table_except(idx, &batch, skip, skip_n);
        if (st != CBERG_OK) {
            batch_reset(&batch);
            free(skip);
            pthread_mutex_unlock(&idx->mu);
            for (size_t j = 0; j < rechunk_n; j++) {
                free(rechunk[j]);
            }
            for (size_t j = 0; j < deleted_n; j++) {
                free(deleted[j]);
            }
            free(rechunk);
            free(deleted);
            return st;
        }

        for (size_t i = 0; i < rechunk_n; i++) {
            char abs[4096];
            snprintf(abs, sizeof(abs), "%s/%s", idx->root, rechunk[i]);
            cberg_chunk_list *list = NULL;
            st = parse_file(idx, abs, rechunk[i], &list);
            if (st != CBERG_OK) {
                batch_reset(&batch);
                free(skip);
                pthread_mutex_unlock(&idx->mu);
                for (size_t j = 0; j < rechunk_n; j++) {
                    free(rechunk[j]);
                }
                for (size_t j = 0; j < deleted_n; j++) {
                    free(deleted[j]);
                }
                free(rechunk);
                free(deleted);
                return st;
            }
            if (list != NULL) {
                st = batch_add_list(&batch, list);
                if (st != CBERG_OK) {
                    cberg_chunk_list_free(list);
                    batch_reset(&batch);
                    free(skip);
                    pthread_mutex_unlock(&idx->mu);
                    for (size_t j = 0; j < rechunk_n; j++) {
                        free(rechunk[j]);
                    }
                    for (size_t j = 0; j < deleted_n; j++) {
                        free(deleted[j]);
                    }
                    free(rechunk);
                    free(deleted);
                    return st;
                }
            }
        }

        st = sync_table(idx, &batch);
        batch_reset(&batch);
        free(skip);
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
