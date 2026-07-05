#ifndef CBERG_CHUNK_KEYS_H
#define CBERG_CHUNK_KEYS_H

#include "codeberg/codeberg.h"

#include <stddef.h>
#include <stdint.h>

#define CBERG_CHUNK_IDENT_MAX 1024
#define CBERG_CHUNK_KEY_MAX (CBERG_CHUNK_IDENT_MAX + 32)

typedef struct chunk_occ_tracker chunk_occ_tracker;

chunk_occ_tracker *chunk_occ_new(void);
void chunk_occ_free(chunk_occ_tracker *tracker);

cberg_status chunk_format_ident(char *buf, size_t cap, const char *path, cberg_chunk_kind kind, const char *symbol);
cberg_status chunk_format_key(char *buf, size_t cap, const char *path, cberg_chunk_kind kind, const char *symbol, uint32_t index);
cberg_status chunk_occ_next(chunk_occ_tracker *tracker, const char *path, cberg_chunk_kind kind, const char *symbol, uint32_t *out_index);

#endif /* CBERG_CHUNK_KEYS_H */
