#include "codeberg/codeberg.h"

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#define CBERG_MAP_INITIAL 1024

typedef struct cberg_map_entry {
    char *key;
    size_t index;
    struct cberg_map_entry *next;
} cberg_map_entry;

struct cberg_chunk_table {
    cberg_stored_chunk *entries;
    size_t len;
    size_t cap;
    cberg_map_entry **buckets;
    size_t bucket_count;
    uint64_t next_id;
    uint8_t fingerprint[CBERG_HASH_LEN];

    cberg_stored_chunk *added;
    size_t added_len;
    cberg_stored_chunk *modified;
    size_t modified_len;
    cberg_stored_chunk *deleted;
    size_t deleted_len;
};

static uint64_t fnv1a(const char *s) {
    uint64_t h = 14695981039346656037ULL;
    while (*s != '\0') {
        h ^= (unsigned char)*s++;
        h *= 1099511628211ULL;
    }
    return h;
}

static void map_clear(cberg_chunk_table *table) {
    if (table->buckets == NULL) {
        return;
    }
    for (size_t i = 0; i < table->bucket_count; i++) {
        cberg_map_entry *entry = table->buckets[i];
        while (entry != NULL) {
            cberg_map_entry *next = entry->next;
            free(entry->key);
            free(entry);
            entry = next;
        }
        table->buckets[i] = NULL;
    }
}

static cberg_status map_insert(cberg_chunk_table *table, const char *key, size_t index) {
    if (table->bucket_count == 0) {
        table->bucket_count = CBERG_MAP_INITIAL;
        table->buckets = calloc(table->bucket_count, sizeof(cberg_map_entry *));
        if (table->buckets == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    uint64_t h = fnv1a(key) % table->bucket_count;
    cberg_map_entry *entry = calloc(1, sizeof(cberg_map_entry));
    if (entry == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    entry->key = strdup(key);
    if (entry->key == NULL) {
        free(entry);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    entry->index = index;
    entry->next = table->buckets[h];
    table->buckets[h] = entry;
    return CBERG_OK;
}

static cberg_map_entry *map_find(cberg_chunk_table *table, const char *key) {
    if (table->buckets == NULL) {
        return NULL;
    }
    uint64_t h = fnv1a(key) % table->bucket_count;
    for (cberg_map_entry *entry = table->buckets[h]; entry != NULL; entry = entry->next) {
        if (strcmp(entry->key, key) == 0) {
            return entry;
        }
    }
    return NULL;
}

static void rebuild_map(cberg_chunk_table *table) {
    map_clear(table);
    for (size_t i = 0; i < table->len; i++) {
        if (map_insert(table, table->entries[i].chunk.key, i) != CBERG_OK) {
            return;
        }
    }
}

static cberg_status reserve_entries(cberg_chunk_table *table, size_t want) {
    if (want <= table->cap) {
        return CBERG_OK;
    }
    size_t cap = table->cap == 0 ? 64 : table->cap * 2;
    while (cap < want) {
        cap *= 2;
    }
    cberg_stored_chunk *grown = realloc(table->entries, cap * sizeof(cberg_stored_chunk));
    if (grown == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    table->entries = grown;
    table->cap = cap;
    return CBERG_OK;
}

static cberg_status store_chunk_copy(const cberg_chunk *src, cberg_chunk *dst) {
    char *key = strdup(src->key);
    char *path = strdup(src->path);
    char *symbol = src->symbol != NULL ? strdup(src->symbol) : NULL;
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

static cberg_status recompute_fingerprint(cberg_chunk_table *table) {
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
    map_clear(table);
    free(table->buckets);
    for (size_t i = 0; i < table->len; i++) {
        free((void *)table->entries[i].chunk.key);
        free((void *)table->entries[i].chunk.path);
        free((void *)table->entries[i].chunk.symbol);
    }
    free(table->entries);
    free(table->added);
    free(table->modified);
    free(table->deleted);
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

cberg_status cberg_chunk_table_sync(cberg_chunk_table *table, const cberg_chunk *incoming, size_t count,
                                    cberg_changes *out_changes) {
    if (table == NULL || out_changes == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (count > 0 && incoming == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
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

    bool *seen = calloc(table->len, sizeof(bool));
    if (seen == NULL && table->len > 0) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    size_t add_cap = 8;
    size_t mod_cap = 8;
    size_t del_cap = 8;
    table->added = calloc(add_cap, sizeof(cberg_stored_chunk));
    table->modified = calloc(mod_cap, sizeof(cberg_stored_chunk));
    table->deleted = calloc(del_cap, sizeof(cberg_stored_chunk));
    if (table->added == NULL || table->modified == NULL || table->deleted == NULL) {
        free(seen);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status status = CBERG_OK;
    size_t pre_len = table->len;

    for (size_t i = 0; i < count; i++) {
        const cberg_chunk *inc = &incoming[i];
        if (inc->key == NULL) {
            status = CBERG_ERR_INVALID_ARGUMENT;
            goto done;
        }
        cberg_map_entry *prev = map_find(table, inc->key);
        if (prev == NULL) {
            if (reserve_entries(table, table->len + 1) != CBERG_OK) {
                status = CBERG_ERR_OUT_OF_MEMORY;
                goto done;
            }
            cberg_stored_chunk stored = {.id = table->next_id++};
            if (store_chunk_copy(inc, &stored.chunk) != CBERG_OK) {
                status = CBERG_ERR_OUT_OF_MEMORY;
                goto done;
            }

            table->entries[table->len++] = stored;
            if (map_insert(table, stored.chunk.key, table->len - 1) != CBERG_OK) {
                status = CBERG_ERR_OUT_OF_MEMORY;
                goto done;
            }

            if (table->added_len == add_cap) {
                add_cap *= 2;
                cberg_stored_chunk *grown = realloc(table->added, add_cap * sizeof(cberg_stored_chunk));
                if (grown == NULL) {
                    status = CBERG_ERR_OUT_OF_MEMORY;
                    goto done;
                }
                table->added = grown;
            }
            table->added[table->added_len++] = stored;
            continue;
        }

        seen[prev->index] = true;
        cberg_stored_chunk *existing = &table->entries[prev->index];
        if (memcmp(existing->chunk.content_hash, inc->content_hash, CBERG_HASH_LEN) != 0) {
            free((void *)existing->chunk.path);
            free((void *)existing->chunk.symbol);
            existing->chunk.path = strdup(inc->path);
            existing->chunk.symbol = inc->symbol != NULL ? strdup(inc->symbol) : NULL;
            existing->chunk.kind = inc->kind;
            existing->chunk.span = inc->span;
            memcpy(existing->chunk.content_hash, inc->content_hash, CBERG_HASH_LEN);
            if (existing->chunk.path == NULL) {
                status = CBERG_ERR_OUT_OF_MEMORY;
                goto done;
            }

            if (table->modified_len == mod_cap) {
                mod_cap *= 2;
                cberg_stored_chunk *grown = realloc(table->modified, mod_cap * sizeof(cberg_stored_chunk));
                if (grown == NULL) {
                    status = CBERG_ERR_OUT_OF_MEMORY;
                    goto done;
                }
                table->modified = grown;
            }
            table->modified[table->modified_len++] = *existing;
        }
    }

    for (size_t i = 0; i < pre_len; i++) {
        if (seen[i]) {
            continue;
        }
        if (table->deleted_len == del_cap) {
            del_cap *= 2;
            cberg_stored_chunk *grown = realloc(table->deleted, del_cap * sizeof(cberg_stored_chunk));
            if (grown == NULL) {
                status = CBERG_ERR_OUT_OF_MEMORY;
                goto done;
            }
            table->deleted = grown;
        }
        table->deleted[table->deleted_len++] = table->entries[i];
    }

    if (table->deleted_len > 0) {
        cberg_stored_chunk *kept = calloc(table->len, sizeof(cberg_stored_chunk));
        if (kept == NULL) {
            status = CBERG_ERR_OUT_OF_MEMORY;
            goto done;
        }
        size_t kept_len = 0;
        for (size_t i = 0; i < pre_len; i++) {
            if (!seen[i]) {
                free((void *)table->entries[i].chunk.key);
                free((void *)table->entries[i].chunk.path);
                free((void *)table->entries[i].chunk.symbol);
                continue;
            }
            kept[kept_len++] = table->entries[i];
        }
        free(table->entries);
        table->entries = kept;
        table->len = kept_len;
        table->cap = kept_len;
        rebuild_map(table);
    }

    if (table->deleted_len > 1) {
        qsort(table->deleted, table->deleted_len, sizeof(cberg_stored_chunk), compare_stored_id);
    }

    status = recompute_fingerprint(table);

done:
    free(seen);
    if (status != CBERG_OK) {
        return status;
    }
    *out_changes = (cberg_changes){
        .added = table->added,
        .added_len = table->added_len,
        .modified = table->modified,
        .modified_len = table->modified_len,
        .deleted = table->deleted,
        .deleted_len = table->deleted_len,
    };
    return CBERG_OK;
}
