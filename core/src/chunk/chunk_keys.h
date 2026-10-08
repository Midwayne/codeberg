#ifndef CBERG_CHUNK_KEYS_H
#define CBERG_CHUNK_KEYS_H

#include "codeberg/codeberg.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define CBERG_CHUNK_IDENT_MAX 1024
#define CBERG_CHUNK_KEY_MAX (CBERG_CHUNK_IDENT_MAX + 32)

typedef struct chunk_occ_tracker chunk_occ_tracker;

chunk_occ_tracker *chunk_occ_new(void);
void chunk_occ_free(chunk_occ_tracker *tracker);

/* True when a symbol of sym_len bytes keeps the chunk ident within CBERG_CHUNK_IDENT_MAX. */
bool chunk_ident_fits(const char *path, cberg_chunk_kind kind, size_t sym_len);

cberg_status chunk_format_key(char *buf, size_t cap, const char *path, cberg_chunk_kind kind, const char *symbol, uint32_t index);
cberg_status chunk_occ_next(chunk_occ_tracker *tracker, const char *path, cberg_chunk_kind kind, const char *symbol, uint32_t *out_index);

#endif /* CBERG_CHUNK_KEYS_H */
