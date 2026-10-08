#ifndef CBERG_STRMAP_H
#define CBERG_STRMAP_H

#include "codeberg/codeberg.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct cberg_strmap cberg_strmap;

typedef void (*cberg_strmap_visit_fn)(const char *key, uint64_t value, void *ctx);

cberg_strmap *cberg_strmap_new(size_t bucket_count);

/* Like cberg_strmap_new, but set() stores the caller's key pointer instead of
 * a private copy. Every key must stay valid and unchanged until the map is
 * cleared or freed (e.g. keys owned by an arena that outlives the map). */
cberg_strmap *cberg_strmap_new_borrowed(size_t bucket_count);
void cberg_strmap_free(cberg_strmap *map);
void cberg_strmap_clear(cberg_strmap *map);

bool cberg_strmap_get(const cberg_strmap *map, const char *key, uint64_t *out_value);
cberg_status cberg_strmap_set(cberg_strmap *map, const char *key, uint64_t value);

void cberg_strmap_visit(cberg_strmap *map, cberg_strmap_visit_fn fn, void *ctx);

#endif /* CBERG_STRMAP_H */
