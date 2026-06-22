#ifndef CBERG_STRMAP_H
#define CBERG_STRMAP_H

#include "codeberg/codeberg.h"

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

/*
 * In-memory string -> uint64_t map (chained buckets, FNV-1a indexing).
 * For content addressing use cberg_hash (XXH3), not this structure.
 */
typedef struct cberg_strmap cberg_strmap;

typedef void (*cberg_strmap_visit_fn)(const char *key, uint64_t value, void *ctx);

cberg_strmap *cberg_strmap_new(size_t bucket_count);
void cberg_strmap_free(cberg_strmap *map);
void cberg_strmap_clear(cberg_strmap *map);

bool cberg_strmap_get(const cberg_strmap *map, const char *key, uint64_t *out_value);
cberg_status cberg_strmap_set(cberg_strmap *map, const char *key, uint64_t value);

void cberg_strmap_visit(cberg_strmap *map, cberg_strmap_visit_fn fn, void *ctx);

#endif /* CBERG_STRMAP_H */
