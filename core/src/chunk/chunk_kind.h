#ifndef CBERG_CHUNK_KIND_H
#define CBERG_CHUNK_KIND_H

#include "codeberg/codeberg.h"

#include <stddef.h>
#include <stdint.h>

/* Shared line-window cap for markdown sections and config key chunks. */
#define CBERG_CHUNK_MAX_SECTION_LINES 200

/* Canonical lowercase name for a chunk kind ("function", "section", …). */
const char *cberg_chunk_kind_name(cberg_chunk_kind kind);

/* Parse a kind filter string (case-insensitive). Returns -1 if unset/unknown. */
int cberg_chunk_kind_parse(const char *s);

/* Map a tree-sitter capture name (not NUL-terminated) to a chunk kind. */
cberg_chunk_kind cberg_chunk_kind_from_capture(const char *name, uint32_t len);

#endif
