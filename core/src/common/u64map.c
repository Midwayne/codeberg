#include "u64map.h"

#include <stdlib.h>
#include <string.h>

/*
 * Linear-probing uint64 -> uint64 map with the same cache profile as cberg_strmap:
 * a dense keys array (8 per 64-byte cache line) is probed for the key or an empty
 * slot, and the parallel values array is touched only on a hit. key == 0 marks an
 * empty slot, so the integer keys are stored directly with no per-node allocation
 * or pointer chasing. No delete (only free), so there are no tombstones. The table
 * is power-of-two sized (index is a mask) and doubles past a 0.75 load factor.
 */

struct cberg_u64map {
    uint64_t *keys; /* 0 == empty slot */
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

/* Mix the key before masking: chunk ids are sequential, and the low bits of
 * sequential keys would cluster badly under linear probing modulo a power of two.
 * splitmix64 finalizer scatters them across the table. */
static inline uint64_t mix64(uint64_t x) {
    x ^= x >> 30;
    x *= 0xbf58476d1ce4e5b9ULL;
    x ^= x >> 27;
    x *= 0x94d049bb133111ebULL;
    x ^= x >> 31;
    return x;
}

cberg_u64map *cberg_u64map_new(size_t bucket_count) {
    size_t cap = round_pow2(bucket_count == 0 ? 64 : bucket_count);
    cberg_u64map *map = calloc(1, sizeof(cberg_u64map));
    if (map == NULL) {
        return NULL;
    }
    map->keys = calloc(cap, sizeof(uint64_t));
    map->values = calloc(cap, sizeof(uint64_t));
    if (map->keys == NULL || map->values == NULL) {
        free(map->keys);
        free(map->values);
        free(map);
        return NULL;
    }
    map->bucket_count = cap;
    return map;
}

void cberg_u64map_free(cberg_u64map *map) {
    if (map == NULL) {
        return;
    }
    free(map->keys);
    free(map->values);
    free(map);
}

bool cberg_u64map_get(const cberg_u64map *map, uint64_t key, uint64_t *out_value) {
    if (map == NULL || key == 0 || map->keys == NULL) {
        return false;
    }
    size_t mask = map->bucket_count - 1;
    size_t i = (size_t)mix64(key) & mask;
    while (map->keys[i] != 0) {
        if (map->keys[i] == key) {
            if (out_value != NULL) {
                *out_value = map->values[i];
            }
            return true;
        }
        i = (i + 1) & mask;
    }
    return false;
}

static cberg_status u64map_resize(cberg_u64map *map, size_t new_count) {
    uint64_t *keys = calloc(new_count, sizeof(uint64_t));
    uint64_t *values = calloc(new_count, sizeof(uint64_t));
    if (keys == NULL || values == NULL) {
        free(keys);
        free(values);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t mask = new_count - 1;
    for (size_t i = 0; i < map->bucket_count; i++) {
        uint64_t k = map->keys[i];
        if (k == 0) {
            continue;
        }
        size_t j = (size_t)mix64(k) & mask;
        while (keys[j] != 0) {
            j = (j + 1) & mask;
        }
        keys[j] = k;
        values[j] = map->values[i];
    }
    free(map->keys);
    free(map->values);
    map->keys = keys;
    map->values = values;
    map->bucket_count = new_count;
    return CBERG_OK;
}

cberg_status cberg_u64map_set(cberg_u64map *map, uint64_t key, uint64_t value) {
    if (map == NULL || key == 0) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (map->keys == NULL) {
        return CBERG_ERR_INTERNAL;
    }

    size_t mask = map->bucket_count - 1;
    size_t i = (size_t)mix64(key) & mask;
    while (map->keys[i] != 0) {
        if (map->keys[i] == key) {
            map->values[i] = value;
            return CBERG_OK;
        }
        i = (i + 1) & mask;
    }

    if ((map->count + 1) * 4 >= map->bucket_count * 3) {
        cberg_status st = u64map_resize(map, map->bucket_count * 2);
        if (st != CBERG_OK) {
            return st;
        }
        mask = map->bucket_count - 1;
        i = (size_t)mix64(key) & mask;
        while (map->keys[i] != 0) {
            i = (i + 1) & mask;
        }
    }

    map->keys[i] = key;
    map->values[i] = value;
    map->count++;
    return CBERG_OK;
}
