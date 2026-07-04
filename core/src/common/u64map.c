#include "u64map.h"

#include "cacheline.h"
#include "grow.h"

#include <stdlib.h>
#include <string.h>

/*
 * Linear-probing uint64 -> uint64 map. Each slot is a {key, value} pair (16
 * bytes, 4 pairs per 64-byte cache line) so a hit loads both fields from one
 * aligned slot instead of chasing separate keys[] and values[] arrays. key ==
 * 0 marks an empty slot. No delete (only free), so there are no tombstones.
 * The table is power-of-two sized (index is a mask) and doubles past a 0.75
 * load factor.
 */

typedef struct {
    uint64_t key;
    uint64_t value;
} u64map_slot;

_Static_assert(sizeof(u64map_slot) == 16, "u64map_slot packs 4 pairs per cache line");
_Static_assert(CBERG_CACHE_LINE % sizeof(u64map_slot) == 0, "integral u64map slots per cache line");

struct cberg_u64map {
    u64map_slot *slots;
    size_t bucket_count; /* power of two */
    size_t count;
};

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
    size_t cap = cberg_round_pow2(bucket_count == 0 ? 64 : bucket_count);
    cberg_u64map *map = calloc(1, sizeof(cberg_u64map));
    if (map == NULL) {
        return NULL;
    }
    map->slots = cberg_cacheline_calloc(cap, sizeof(u64map_slot));
    if (map->slots == NULL) {
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
    cberg_cacheline_free(map->slots);
    free(map);
}

bool cberg_u64map_get(const cberg_u64map *map, uint64_t key, uint64_t *out_value) {
    if (map == NULL || key == 0 || map->slots == NULL) {
        return false;
    }
    size_t mask = map->bucket_count - 1;
    size_t i = (size_t)mix64(key) & mask;
    while (map->slots[i].key != 0) {
        if (map->slots[i].key == key) {
            if (out_value != NULL) {
                *out_value = map->slots[i].value;
            }
            return true;
        }
        i = (i + 1) & mask;
    }
    return false;
}

static cberg_status u64map_resize(cberg_u64map *map, size_t new_count) {
    u64map_slot *slots = cberg_cacheline_calloc(new_count, sizeof(u64map_slot));
    if (slots == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t mask = new_count - 1;
    for (size_t i = 0; i < map->bucket_count; i++) {
        uint64_t k = map->slots[i].key;
        if (k == 0) {
            continue;
        }
        size_t j = (size_t)mix64(k) & mask;
        while (slots[j].key != 0) {
            j = (j + 1) & mask;
        }
        slots[j].key = k;
        slots[j].value = map->slots[i].value;
    }
    cberg_cacheline_free(map->slots);
    map->slots = slots;
    map->bucket_count = new_count;
    return CBERG_OK;
}

cberg_status cberg_u64map_set(cberg_u64map *map, uint64_t key, uint64_t value) {
    if (map == NULL || key == 0) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (map->slots == NULL) {
        return CBERG_ERR_INTERNAL;
    }

    size_t mask = map->bucket_count - 1;
    size_t i = (size_t)mix64(key) & mask;
    while (map->slots[i].key != 0) {
        if (map->slots[i].key == key) {
            map->slots[i].value = value;
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
        while (map->slots[i].key != 0) {
            i = (i + 1) & mask;
        }
    }

    map->slots[i].key = key;
    map->slots[i].value = value;
    map->count++;
    return CBERG_OK;
}
