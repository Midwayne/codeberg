#include "codeberg/codeberg.h"

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "grow.h"
#include "strmap.h"
#include "strutil.h"

#define CBERG_MAP_INITIAL 1024

struct cberg_chunk_table {
    cberg_stored_chunk *entries;
    size_t len;
    size_t cap;
    cberg_strmap *key_index;
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
    table_free_change_lists(table);

    table->entries = next->entries;
    table->len = next->len;
    table->cap = next->cap;
    table->key_index = next->key_index;
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
