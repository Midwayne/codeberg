#ifndef CBERG_ARENA_H
#define CBERG_ARENA_H

#include <stddef.h>

#include "codeberg/codeberg.h"

typedef struct cberg_arena cberg_arena;

cberg_arena *cberg_arena_new(void);
void cberg_arena_free(cberg_arena *arena);
void cberg_arena_reset(cberg_arena *arena);

/* Returns NULL on OOM. Alignment is at least 8. */
void *cberg_arena_alloc(cberg_arena *arena, size_t size);
char *cberg_arena_dup(cberg_arena *arena, const char *src, size_t len);
char *cberg_arena_strdup(cberg_arena *arena, const char *src);

#endif /* CBERG_ARENA_H */
