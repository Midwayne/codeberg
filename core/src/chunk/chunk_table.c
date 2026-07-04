#include "codeberg/codeberg.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cacheline.h"
#include "grow.h"
#include "strmap.h"
#include "strutil.h"
#include "u64map.h"

_Static_assert(offsetof(cberg_chunk, content_hash) == 0, "content_hash leads cberg_chunk for cache-line compares");
_Static_assert(offsetof(cberg_chunk, content_hash) + CBERG_HASH_LEN <= CBERG_CACHE_LINE,
               "content_hash fits in one cache line");
_Static_assert(offsetof(cberg_stored_chunk, chunk.content_hash) + CBERG_HASH_LEN <= CBERG_CACHE_LINE,
               "stored id + content_hash fit in one cache line");

#define CBERG_MAP_INITIAL 1024

struct cberg_chunk_table {
    cberg_stored_chunk *entries;
    size_t len;
    size_t cap;
    cberg_strmap *key_index;
    cberg_u64map *id_index; /* chunk id -> entries[] index, for O(1) lookup by id */
    uint64_t next_id;
    uint8_t fingerprint[CBERG_HASH_LEN];

    cberg_stored_chunk *added;
    size_t added_len;
    size_t added_cap;
    cberg_stored_chunk *modified;
    size_t modified_len;
    size_t modified_cap;
    cberg_stored_chunk *deleted;
    size_t deleted_len;
    size_t deleted_cap;
};

static void free_chunk_strings(cberg_chunk *chunk) {
    free((void *)chunk->key);
    free((void *)chunk->path);
    free((void *)chunk->symbol);
}

static bool map_find(const cberg_chunk_table *table, const char *key, size_t *out_index) {
    if (table->key_index == NULL) {
        return false;
    }
    uint64_t index = 0;
    if (!cberg_strmap_get(table->key_index, key, &index)) {
        return false;
    }
    if (out_index != NULL) {
        *out_index = (size_t)index;
    }
    return true;
}

static cberg_status push_change(cberg_stored_chunk **list, size_t *len, size_t *cap, cberg_stored_chunk item) {
    size_t next_cap = cberg_grow_cap(*cap, *len + 1, 8);
    if (next_cap != *cap) {
        cberg_stored_chunk *grown = realloc(*list, next_cap * sizeof(cberg_stored_chunk));
        if (grown == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        *list = grown;
        *cap = next_cap;
    }
    (*list)[(*len)++] = item;
    return CBERG_OK;
}

static cberg_status store_chunk_copy(const cberg_chunk *src, cberg_chunk *dst) {
    char *key = cberg_strdup(src->key);
    char *path = cberg_strdup(src->path);
    char *symbol = src->symbol != NULL ? cberg_strdup(src->symbol) : NULL;
    if (key == NULL || path == NULL) {
        free(key);
        free(path);
        free(symbol);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    dst->key = key;
    dst->path = path;
    dst->symbol = symbol;
    dst->kind = src->kind;
    dst->span = src->span;
    memcpy(dst->content_hash, src->content_hash, CBERG_HASH_LEN);
    return CBERG_OK;
}

static cberg_status push_change_owned(cberg_stored_chunk **list, size_t *len, size_t *cap,
                                      const cberg_stored_chunk *src) {
    cberg_stored_chunk snap = {.id = src->id};
    cberg_status st = store_chunk_copy(&src->chunk, &snap.chunk);
    if (st != CBERG_OK) {
        return st;
    }
    st = push_change(list, len, cap, snap);
    if (st != CBERG_OK) {
        free_chunk_strings(&snap.chunk);
    }
    return st;
}

static cberg_status table_reserve_entries(cberg_chunk_table *table, size_t want) {
    size_t cap = cberg_grow_cap(table->cap, want, 64);
    if (cap == table->cap) {
        return CBERG_OK;
    }
    cberg_stored_chunk *grown = realloc(table->entries, cap * sizeof(cberg_stored_chunk));
    if (grown == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    table->entries = grown;
    table->cap = cap;
    return CBERG_OK;
}

static cberg_status table_append(cberg_chunk_table *table, cberg_stored_chunk stored) {
    if (table_reserve_entries(table, table->len + 1) != CBERG_OK) {
        free_chunk_strings(&stored.chunk);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t index = table->len;
    table->entries[index] = stored;
    table->len++;
    if (table->key_index == NULL) {
        table->key_index = cberg_strmap_new(CBERG_MAP_INITIAL);
        if (table->key_index == NULL) {
            table->len--;
            free_chunk_strings(&stored.chunk);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    if (cberg_strmap_set(table->key_index, stored.chunk.key, (uint64_t)index) != CBERG_OK) {
        table->len--;
        free_chunk_strings(&stored.chunk);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    if (table->id_index == NULL) {
        table->id_index = cberg_u64map_new(CBERG_MAP_INITIAL);
        if (table->id_index == NULL) {
            table->len--;
            free_chunk_strings(&stored.chunk);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    if (cberg_u64map_set(table->id_index, stored.id, (uint64_t)index) != CBERG_OK) {
        table->len--;
        free_chunk_strings(&stored.chunk);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    return CBERG_OK;
}

static cberg_status table_recompute_fingerprint(cberg_chunk_table *table) {
    if (table->len == 0) {
        memset(table->fingerprint, 0, CBERG_HASH_LEN);
        return CBERG_OK;
    }
    const char **keys = calloc(table->len, sizeof(char *));
    const uint8_t **hash_ptrs = calloc(table->len, sizeof(uint8_t *));
    if (keys == NULL || hash_ptrs == NULL) {
        free(keys);
        free(hash_ptrs);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    for (size_t i = 0; i < table->len; i++) {
        keys[i] = table->entries[i].chunk.key;
        hash_ptrs[i] = table->entries[i].chunk.content_hash;
    }
    cberg_status st = cberg_fingerprint(keys, hash_ptrs, table->len, table->fingerprint);
    free(hash_ptrs);
    free(keys);
    return st;
}

static void table_free_entry_strings(cberg_chunk_table *table) {
    for (size_t i = 0; i < table->len; i++) {
        free_chunk_strings(&table->entries[i].chunk);
    }
}

static void table_free_change_lists(cberg_chunk_table *table) {
    for (size_t i = 0; i < table->added_len; i++) {
        free_chunk_strings(&table->added[i].chunk);
    }
    for (size_t i = 0; i < table->modified_len; i++) {
        free_chunk_strings(&table->modified[i].chunk);
    }
    for (size_t i = 0; i < table->deleted_len; i++) {
        free_chunk_strings(&table->deleted[i].chunk);
    }
    free(table->added);
    free(table->modified);
    free(table->deleted);
    table->added = NULL;
    table->modified = NULL;
    table->deleted = NULL;
    table->added_len = 0;
    table->modified_len = 0;
    table->deleted_len = 0;
    table->added_cap = 0;
    table->modified_cap = 0;
    table->deleted_cap = 0;
}

static void table_discard(cberg_chunk_table *table) {
    if (table == NULL) {
        return;
    }
    table_free_entry_strings(table);
    free(table->entries);
    cberg_strmap_free(table->key_index);
    cberg_u64map_free(table->id_index);
    table_free_change_lists(table);
    free(table);
}

cberg_chunk_table *cberg_chunk_table_new(void) {
    cberg_chunk_table *table = calloc(1, sizeof(cberg_chunk_table));
    if (table == NULL) {
        return NULL;
    }
    table->next_id = 1;
    return table;
}

void cberg_chunk_table_free(cberg_chunk_table *table) {
    if (table == NULL) {
        return;
    }
    table_free_entry_strings(table);
    free(table->entries);
    cberg_strmap_free(table->key_index);
    cberg_u64map_free(table->id_index);
    table_free_change_lists(table);
    free(table);
}

void cberg_chunk_table_fingerprint(const cberg_chunk_table *table, uint8_t out[CBERG_HASH_LEN]) {
    if (table == NULL || out == NULL) {
        return;
    }
    memcpy(out, table->fingerprint, CBERG_HASH_LEN);
}

size_t cberg_chunk_table_len(const cberg_chunk_table *table) {
    return table == NULL ? 0 : table->len;
}

const cberg_stored_chunk *cberg_chunk_table_at(const cberg_chunk_table *table, size_t index) {
    if (table == NULL || index >= table->len) {
        return NULL;
    }
    return &table->entries[index];
}

const cberg_stored_chunk *cberg_chunk_table_find_by_id(const cberg_chunk_table *table, uint64_t id) {
    if (table == NULL || table->id_index == NULL) {
        return NULL;
    }
    uint64_t index = 0;
    if (!cberg_u64map_get(table->id_index, id, &index) || (size_t)index >= table->len) {
        return NULL;
    }
    return &table->entries[index];
}

static int compare_stored_id(const void *a, const void *b) {
    const cberg_stored_chunk *ca = a;
    const cberg_stored_chunk *cb = b;
    if (ca->id < cb->id) {
        return -1;
    }
    if (ca->id > cb->id) {
        return 1;
    }
    return 0;
}

static cberg_status sync_apply_incoming(cberg_chunk_table *next, const cberg_chunk_table *table, const cberg_chunk *inc,
                                        bool *seen) {
    size_t next_index = 0;
    if (map_find(next, inc->key, &next_index)) {
        cberg_stored_chunk *slot = &next->entries[next_index];
        size_t live_index = 0;
        if (map_find(table, inc->key, &live_index)) {
            seen[live_index] = true;
        }
        bool hash_changed = memcmp(slot->chunk.content_hash, inc->content_hash, CBERG_HASH_LEN) != 0;
        free_chunk_strings(&slot->chunk);
        cberg_status status = store_chunk_copy(inc, &slot->chunk);
        if (status != CBERG_OK) {
            return status;
        }
        if (hash_changed) {
            return push_change_owned(&next->modified, &next->modified_len, &next->modified_cap, slot);
        }
        return CBERG_OK;
    }

    size_t live_index = 0;
    if (!map_find(table, inc->key, &live_index)) {
        cberg_stored_chunk stored = {.id = next->next_id++};
        cberg_status status = store_chunk_copy(inc, &stored.chunk);
        if (status != CBERG_OK) {
            return status;
        }
        status = table_append(next, stored);
        if (status != CBERG_OK) {
            return status;
        }
        return push_change_owned(&next->added, &next->added_len, &next->added_cap, &next->entries[next->len - 1]);
    }

    seen[live_index] = true;
    const cberg_stored_chunk *existing = &table->entries[live_index];
    bool hash_changed = memcmp(existing->chunk.content_hash, inc->content_hash, CBERG_HASH_LEN) != 0;
    cberg_stored_chunk stored = {.id = existing->id};
    cberg_status status =
        hash_changed ? store_chunk_copy(inc, &stored.chunk) : store_chunk_copy(&existing->chunk, &stored.chunk);
    if (status != CBERG_OK) {
        return status;
    }
    status = table_append(next, stored);
    if (status != CBERG_OK) {
        return status;
    }
    if (hash_changed) {
        return push_change_owned(&next->modified, &next->modified_len, &next->modified_cap, &next->entries[next->len - 1]);
    }
    return CBERG_OK;
}

static void table_commit(cberg_chunk_table *table, cberg_chunk_table *next) {
    table_free_entry_strings(table);
    free(table->entries);
    cberg_strmap_free(table->key_index);
    cberg_u64map_free(table->id_index);
    table_free_change_lists(table);

    table->entries = next->entries;
    table->len = next->len;
    table->cap = next->cap;
    table->key_index = next->key_index;
    table->id_index = next->id_index;
    table->next_id = next->next_id;
    memcpy(table->fingerprint, next->fingerprint, CBERG_HASH_LEN);
    table->added = next->added;
    table->added_len = next->added_len;
    table->added_cap = next->added_cap;
    table->modified = next->modified;
    table->modified_len = next->modified_len;
    table->modified_cap = next->modified_cap;
    table->deleted = next->deleted;
    table->deleted_len = next->deleted_len;
    table->deleted_cap = next->deleted_cap;
}

cberg_status cberg_chunk_table_sync(cberg_chunk_table *table, const cberg_chunk *incoming, size_t count,
                                    cberg_changes *out_changes) {
    if (table == NULL || out_changes == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (count > 0 && incoming == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    cberg_chunk_table *next = calloc(1, sizeof(cberg_chunk_table));
    if (next == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    next->next_id = table->next_id;

    bool *seen = calloc(table->len, sizeof(bool));
    if (seen == NULL && table->len > 0) {
        table_discard(next);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status status = CBERG_OK;

    for (size_t i = 0; i < count; i++) {
        const cberg_chunk *inc = &incoming[i];
        if (inc->key == NULL) {
            status = CBERG_ERR_INVALID_ARGUMENT;
            goto fail;
        }
        status = sync_apply_incoming(next, table, inc, seen);
        if (status != CBERG_OK) {
            goto fail;
        }
    }

    for (size_t i = 0; i < table->len; i++) {
        if (seen[i]) {
            continue;
        }
        status = push_change_owned(&next->deleted, &next->deleted_len, &next->deleted_cap, &table->entries[i]);
        if (status != CBERG_OK) {
            goto fail;
        }
    }

    if (next->deleted_len > 1) {
        qsort(next->deleted, next->deleted_len, sizeof(cberg_stored_chunk), compare_stored_id);
    }

    status = table_recompute_fingerprint(next);
    if (status != CBERG_OK) {
        goto fail;
    }

    table_commit(table, next);

    free(seen);
    free(next);
    *out_changes = (cberg_changes){
        .added = table->added,
        .added_len = table->added_len,
        .modified = table->modified,
        .modified_len = table->modified_len,
        .deleted = table->deleted,
        .deleted_len = table->deleted_len,
    };
    return CBERG_OK;

fail:
    free(seen);
    table_discard(next);
    return status;
}

/* ----------------------------------------------------------- persistence */

/*
 * On-disk snapshot of the id<->chunk mapping, so a restarted indexer can diff
 * the repository against the chunks it already embedded instead of treating
 * every chunk as new. Little-endian-of-the-host fixed-width fields; a magic and
 * version guard means any mismatch (older format, different machine) reads back
 * as NOT_FOUND and the caller falls back to a cold rebuild. NUL string length is
 * encoded as 0xFFFFFFFF (symbol may be absent; key and path never are).
 */
#define CBERG_CHUNK_TABLE_MAGIC "CBT1"
#define CBERG_CHUNK_TABLE_VERSION 1u
#define CBERG_STR_NULL 0xFFFFFFFFu

static cberg_status w_u32(FILE *f, uint32_t v) {
    return fwrite(&v, sizeof v, 1, f) == 1 ? CBERG_OK : CBERG_ERR_IO;
}
static cberg_status w_u64(FILE *f, uint64_t v) {
    return fwrite(&v, sizeof v, 1, f) == 1 ? CBERG_OK : CBERG_ERR_IO;
}
static cberg_status w_bytes(FILE *f, const void *p, size_t n) {
    return n == 0 || fwrite(p, 1, n, f) == n ? CBERG_OK : CBERG_ERR_IO;
}
static cberg_status w_str(FILE *f, const char *s) {
    if (s == NULL) {
        return w_u32(f, CBERG_STR_NULL);
    }
    size_t n = strlen(s);
    if (n >= CBERG_STR_NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_status st = w_u32(f, (uint32_t)n);
    return st != CBERG_OK ? st : w_bytes(f, s, n);
}

static cberg_status r_exact(FILE *f, void *p, size_t n) {
    return n == 0 || fread(p, 1, n, f) == n ? CBERG_OK : CBERG_ERR_IO;
}
static cberg_status r_u32(FILE *f, uint32_t *v) {
    return r_exact(f, v, sizeof *v);
}
static cberg_status r_u64(FILE *f, uint64_t *v) {
    return r_exact(f, v, sizeof *v);
}
static cberg_status r_str(FILE *f, char **out) {
    uint32_t n = 0;
    cberg_status st = r_u32(f, &n);
    if (st != CBERG_OK) {
        return st;
    }
    if (n == CBERG_STR_NULL) {
        *out = NULL;
        return CBERG_OK;
    }
    char *s = malloc((size_t)n + 1);
    if (s == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    st = r_exact(f, s, n);
    if (st != CBERG_OK) {
        free(s);
        return st;
    }
    s[n] = '\0';
    *out = s;
    return CBERG_OK;
}

cberg_status cberg_chunk_table_save(const cberg_chunk_table *table, const char *path) {
    if (table == NULL || path == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char tmp[4096];
    int n = snprintf(tmp, sizeof tmp, "%s.tmp", path);
    if (n < 0 || (size_t)n >= sizeof tmp) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    FILE *f = fopen(tmp, "wb");
    if (f == NULL) {
        return CBERG_ERR_IO;
    }
    cberg_status st = CBERG_OK;
    if (w_bytes(f, CBERG_CHUNK_TABLE_MAGIC, 4) != CBERG_OK || w_u32(f, CBERG_CHUNK_TABLE_VERSION) != CBERG_OK ||
        w_u64(f, table->next_id) != CBERG_OK || w_u64(f, table->len) != CBERG_OK) {
        st = CBERG_ERR_IO;
        goto fail;
    }
    for (size_t i = 0; i < table->len; i++) {
        const cberg_stored_chunk *sc = &table->entries[i];
        if (w_u64(f, sc->id) != CBERG_OK || w_u32(f, (uint32_t)sc->chunk.kind) != CBERG_OK ||
            w_u32(f, sc->chunk.span.start_byte) != CBERG_OK || w_u32(f, sc->chunk.span.end_byte) != CBERG_OK ||
            w_u32(f, sc->chunk.span.start_line) != CBERG_OK || w_u32(f, sc->chunk.span.end_line) != CBERG_OK ||
            w_bytes(f, sc->chunk.content_hash, CBERG_HASH_LEN) != CBERG_OK || w_str(f, sc->chunk.key) != CBERG_OK ||
            w_str(f, sc->chunk.path) != CBERG_OK || w_str(f, sc->chunk.symbol) != CBERG_OK) {
            st = CBERG_ERR_IO;
            goto fail;
        }
    }
    if (fflush(f) != 0) {
        st = CBERG_ERR_IO;
        goto fail;
    }
    if (fclose(f) != 0) {
        f = NULL;
        st = CBERG_ERR_IO;
        goto fail;
    }
    if (rename(tmp, path) != 0) {
        st = CBERG_ERR_IO;
        remove(tmp);
        return st;
    }
    return CBERG_OK;

fail:
    if (f != NULL) {
        fclose(f);
    }
    remove(tmp);
    return st;
}

cberg_status cberg_chunk_table_load(const char *path, cberg_chunk_table **out_table) {
    if (path == NULL || out_table == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_table = NULL;
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }

    char magic[4];
    uint32_t version = 0;
    uint64_t next_id = 0, count = 0;
    if (r_exact(f, magic, 4) != CBERG_OK || memcmp(magic, CBERG_CHUNK_TABLE_MAGIC, 4) != 0 ||
        r_u32(f, &version) != CBERG_OK || version != CBERG_CHUNK_TABLE_VERSION || r_u64(f, &next_id) != CBERG_OK ||
        r_u64(f, &count) != CBERG_OK) {
        fclose(f);
        return CBERG_ERR_NOT_FOUND;
    }

    cberg_chunk_table *table = cberg_chunk_table_new();
    if (table == NULL) {
        fclose(f);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = CBERG_OK;
    for (uint64_t i = 0; i < count; i++) {
        cberg_stored_chunk stored = {0};
        uint32_t kind = 0;
        char *key = NULL, *path_str = NULL, *symbol = NULL;
        if (r_u64(f, &stored.id) != CBERG_OK || r_u32(f, &kind) != CBERG_OK ||
            r_u32(f, &stored.chunk.span.start_byte) != CBERG_OK ||
            r_u32(f, &stored.chunk.span.end_byte) != CBERG_OK ||
            r_u32(f, &stored.chunk.span.start_line) != CBERG_OK ||
            r_u32(f, &stored.chunk.span.end_line) != CBERG_OK ||
            r_exact(f, stored.chunk.content_hash, CBERG_HASH_LEN) != CBERG_OK || r_str(f, &key) != CBERG_OK ||
            r_str(f, &path_str) != CBERG_OK || r_str(f, &symbol) != CBERG_OK || key == NULL || path_str == NULL) {
            free(key);
            free(path_str);
            free(symbol);
            st = CBERG_ERR_NOT_FOUND; /* truncated/corrupt -> cold start */
            break;
        }
        stored.chunk.kind = (cberg_chunk_kind)kind;
        stored.chunk.key = key;
        stored.chunk.path = path_str;
        stored.chunk.symbol = symbol;
        st = table_append(table, stored); /* takes ownership; frees on failure */
        if (st != CBERG_OK) {
            break;
        }
    }
    fclose(f);
    if (st != CBERG_OK) {
        cberg_chunk_table_free(table);
        return st;
    }

    table->next_id = next_id;
    st = table_recompute_fingerprint(table);
    if (st != CBERG_OK) {
        cberg_chunk_table_free(table);
        return st;
    }

    *out_table = table;
    return CBERG_OK;
}
