#ifndef CBERG_U64MAP_H
#define CBERG_U64MAP_H

#include "codeberg/codeberg.h"

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

/*
 * Open-addressing uint64 -> uint64 map. Internal to the library (not exported).
 * Key 0 is reserved as the empty-slot sentinel; callers must not store key 0
 * (cberg_u64map_set rejects it). Each slot is a {key, value} pair (16 bytes,
 * 4 pairs per 64-byte cache line). Used for the chunk table's id -> entry index
 * so a search can resolve a result id to its chunk in O(1) instead of scanning.
 */
typedef struct cberg_u64map cberg_u64map;

cberg_u64map *cberg_u64map_new(size_t bucket_count);
void cberg_u64map_free(cberg_u64map *map);

bool cberg_u64map_get(const cberg_u64map *map, uint64_t key, uint64_t *out_value);
cberg_status cberg_u64map_set(cberg_u64map *map, uint64_t key, uint64_t value);

#endif /* CBERG_U64MAP_H */
