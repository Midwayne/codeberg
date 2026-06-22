#include "strmap.h"

#include "fnv.h"
#include "strutil.h"

#include <stdlib.h>
#include <string.h>

typedef struct cberg_strmap_entry {
    char *key;
    uint64_t value;
    struct cberg_strmap_entry *next;
} cberg_strmap_entry;

struct cberg_strmap {
    cberg_strmap_entry **buckets;
    size_t bucket_count;
};

cberg_strmap *cberg_strmap_new(size_t bucket_count) {
    if (bucket_count == 0) {
        bucket_count = 64;
    }
    cberg_strmap *map = calloc(1, sizeof(cberg_strmap));
    if (map == NULL) {
        return NULL;
    }
    map->bucket_count = bucket_count;
    map->buckets = calloc(bucket_count, sizeof(cberg_strmap_entry *));
    if (map->buckets == NULL) {
        free(map);
        return NULL;
    }
    return map;
}

void cberg_strmap_clear(cberg_strmap *map) {
    if (map == NULL || map->buckets == NULL) {
        return;
    }
    for (size_t i = 0; i < map->bucket_count; i++) {
        cberg_strmap_entry *entry = map->buckets[i];
        while (entry != NULL) {
            cberg_strmap_entry *next = entry->next;
            free(entry->key);
            free(entry);
            entry = next;
        }
        map->buckets[i] = NULL;
    }
}

void cberg_strmap_free(cberg_strmap *map) {
    if (map == NULL) {
        return;
    }
    cberg_strmap_clear(map);
    free(map->buckets);
    free(map);
}

bool cberg_strmap_get(const cberg_strmap *map, const char *key, uint64_t *out_value) {
    if (map == NULL || key == NULL || map->buckets == NULL) {
        return false;
    }
    uint64_t h = cberg_fnv1a(key) % map->bucket_count;
    for (cberg_strmap_entry *entry = map->buckets[h]; entry != NULL; entry = entry->next) {
        if (strcmp(entry->key, key) == 0) {
            if (out_value != NULL) {
                *out_value = entry->value;
            }
            return true;
        }
    }
    return false;
}

cberg_status cberg_strmap_set(cberg_strmap *map, const char *key, uint64_t value) {
    if (map == NULL || key == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (map->buckets == NULL) {
        return CBERG_ERR_INTERNAL;
    }
    uint64_t h = cberg_fnv1a(key) % map->bucket_count;
    for (cberg_strmap_entry *entry = map->buckets[h]; entry != NULL; entry = entry->next) {
        if (strcmp(entry->key, key) == 0) {
            entry->value = value;
            return CBERG_OK;
        }
    }
    cberg_strmap_entry *entry = calloc(1, sizeof(cberg_strmap_entry));
    if (entry == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    entry->key = cberg_strdup(key);
    if (entry->key == NULL) {
        free(entry);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    entry->value = value;
    entry->next = map->buckets[h];
    map->buckets[h] = entry;
    return CBERG_OK;
}

void cberg_strmap_visit(cberg_strmap *map, cberg_strmap_visit_fn fn, void *ctx) {
    if (map == NULL || fn == NULL || map->buckets == NULL) {
        return;
    }
    for (size_t i = 0; i < map->bucket_count; i++) {
        for (cberg_strmap_entry *entry = map->buckets[i]; entry != NULL; entry = entry->next) {
            fn(entry->key, entry->value, ctx);
        }
    }
}
