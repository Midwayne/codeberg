#include "strmap.h"

#include "cacheline.h"
#include "fnv.h"
#include "strutil.h"

#include <stdlib.h>
#include <string.h>

/*
 * Open-addressing (linear-probing) string -> u64 map.
 *
 * Struct-of-arrays layout: a dense uint64 hash array is probed first, with the
 * key pointers and values in parallel arrays touched only on a hash match. A
 * lookup scans the hash array (8 bytes/slot, 8 per 64-byte cache line) until it
 * meets the slot's full hash or an empty slot, so a miss costs a short run of
 * contiguous reads instead of chasing per-node `next` pointers across the heap
 * and dereferencing a separate strdup'd key on every step. Bucket storage is
 * cache-line aligned so probe runs do not straddle line boundaries at the
 * array base.
 *
 * hash == 0 marks an empty slot; cberg_fnv1a is nudged off 0 (hash_key) so a
 * real key never collides with the empty sentinel. The map has no delete (only
 * clear), so there are no tombstones and probe runs stay short. bucket_count is
 * a power of two, so the slot index is a mask rather than a modulo. The table
 * doubles past a 0.75 load factor — the old fixed-bucket chained map never grew,
 * which let chains (and their O(n) lookups) grow without bound on the indexing
 * hot path.
 */

struct cberg_strmap {
    uint64_t *hashes; /* 0 == empty slot */
    char **keys;
    uint64_t *values;
    size_t bucket_count; /* power of two */
    size_t count;
};

static size_t round_pow2(size_t n) {
    size_t p = 64;
    while (p < n) {
        p <<= 1;
    }
    return p;
}

static inline uint64_t hash_key(const char *key) {
    uint64_t h = cberg_fnv1a(key);
    return h + (h == 0); /* reserve 0 for the empty-slot sentinel */
}

static void strmap_free_buckets(cberg_strmap *map) {
    cberg_cacheline_free(map->hashes);
    cberg_cacheline_free(map->keys);
    cberg_cacheline_free(map->values);
    map->hashes = NULL;
    map->keys = NULL;
    map->values = NULL;
}

static cberg_status strmap_alloc_buckets(size_t cap, uint64_t **hashes, char ***keys, uint64_t **values) {
    *hashes = cberg_cacheline_calloc(cap, sizeof(uint64_t));
    *keys = cberg_cacheline_calloc(cap, sizeof(char *));
    *values = cberg_cacheline_calloc(cap, sizeof(uint64_t));
    if (*hashes == NULL || *keys == NULL || *values == NULL) {
        cberg_cacheline_free(*hashes);
        cberg_cacheline_free(*keys);
        cberg_cacheline_free(*values);
        *hashes = NULL;
        *keys = NULL;
        *values = NULL;
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    return CBERG_OK;
}

cberg_strmap *cberg_strmap_new(size_t bucket_count) {
    size_t cap = round_pow2(bucket_count == 0 ? 64 : bucket_count);
    cberg_strmap *map = calloc(1, sizeof(cberg_strmap));
    if (map == NULL) {
        return NULL;
    }
    if (strmap_alloc_buckets(cap, &map->hashes, &map->keys, &map->values) != CBERG_OK) {
        free(map);
        return NULL;
    }
    map->bucket_count = cap;
    return map;
}

void cberg_strmap_clear(cberg_strmap *map) {
    if (map == NULL || map->hashes == NULL) {
        return;
    }
    for (size_t i = 0; i < map->bucket_count; i++) {
        if (map->hashes[i] != 0) {
            free(map->keys[i]);
            map->keys[i] = NULL;
        }
    }
    memset(map->hashes, 0, map->bucket_count * sizeof(uint64_t));
    map->count = 0;
}

void cberg_strmap_free(cberg_strmap *map) {
    if (map == NULL) {
        return;
    }
    cberg_strmap_clear(map);
    strmap_free_buckets(map);
    free(map);
}

bool cberg_strmap_get(const cberg_strmap *map, const char *key, uint64_t *out_value) {
    if (map == NULL || key == NULL || map->hashes == NULL) {
        return false;
    }
    uint64_t h = hash_key(key);
    size_t mask = map->bucket_count - 1;
    size_t i = (size_t)h & mask;
    while (map->hashes[i] != 0) {
        if (map->hashes[i] == h && strcmp(map->keys[i], key) == 0) {
            if (out_value != NULL) {
                *out_value = map->values[i];
            }
            return true;
        }
        i = (i + 1) & mask;
    }
    return false;
}

/* Reinsert every live slot into a fresh, larger SoA. Keys keep their stored
 * hash, so no string is re-hashed and the move is a pure pointer copy. */
static cberg_status strmap_resize(cberg_strmap *map, size_t new_count) {
    uint64_t *hashes = NULL;
    char **keys = NULL;
    uint64_t *values = NULL;
    if (strmap_alloc_buckets(new_count, &hashes, &keys, &values) != CBERG_OK) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t mask = new_count - 1;
    for (size_t i = 0; i < map->bucket_count; i++) {
        uint64_t h = map->hashes[i];
        if (h == 0) {
            continue;
        }
        size_t j = (size_t)h & mask;
        while (hashes[j] != 0) {
            j = (j + 1) & mask;
        }
        hashes[j] = h;
        keys[j] = map->keys[i];
        values[j] = map->values[i];
    }
    strmap_free_buckets(map);
    map->hashes = hashes;
    map->keys = keys;
    map->values = values;
    map->bucket_count = new_count;
    return CBERG_OK;
}

cberg_status cberg_strmap_set(cberg_strmap *map, const char *key, uint64_t value) {
    if (map == NULL || key == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (map->hashes == NULL) {
        return CBERG_ERR_INTERNAL;
    }

    uint64_t h = hash_key(key);
    size_t mask = map->bucket_count - 1;
    size_t i = (size_t)h & mask;
    while (map->hashes[i] != 0) {
        if (map->hashes[i] == h && strcmp(map->keys[i], key) == 0) {
            map->values[i] = value;
            return CBERG_OK;
        }
        i = (i + 1) & mask;
    }

    /* New key. Grow past a 0.75 load factor before inserting so probe runs stay
     * short, then re-probe in the resized table for the empty slot. */
    if ((map->count + 1) * 4 >= map->bucket_count * 3) {
        cberg_status st = strmap_resize(map, map->bucket_count * 2);
        if (st != CBERG_OK) {
            return st;
        }
        mask = map->bucket_count - 1;
        i = (size_t)h & mask;
        while (map->hashes[i] != 0) {
            i = (i + 1) & mask;
        }
    }

    char *kdup = cberg_strdup(key);
    if (kdup == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    map->hashes[i] = h;
    map->keys[i] = kdup;
    map->values[i] = value;
    map->count++;
    return CBERG_OK;
}

void cberg_strmap_visit(cberg_strmap *map, cberg_strmap_visit_fn fn, void *ctx) {
    if (map == NULL || fn == NULL || map->hashes == NULL) {
        return;
    }
    for (size_t i = 0; i < map->bucket_count; i++) {
        if (map->hashes[i] != 0) {
            fn(map->keys[i], map->values[i], ctx);
        }
    }
}
