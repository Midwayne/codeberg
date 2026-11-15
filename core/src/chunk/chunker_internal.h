#ifndef CBERG_CHUNKER_INTERNAL_H
#define CBERG_CHUNKER_INTERNAL_H

/*
 * Shared between the chunkers:
 *
 *   chunker.c         tree-sitter languages: parser/query reuse, symbol chunks
 *   chunk_markdown.c  heading-aware sections
 *   chunk_config.c    YAML / TOML / JSON top-level keys
 *   chunk_list.c      the chunk list itself, and fixed line windows
 */

#include "codeberg/codeberg.h"

#include "arena.h"

struct cberg_chunk_list {
    cberg_arena *arena; /* owns every chunk's key, path, and symbol */
    cberg_chunk *items;
    size_t len;
    size_t cap;
};

/* An empty chunk list with its arena, or NULL when out of memory. The caller
 * owns it and releases it with cberg_chunk_list_free. */
cberg_chunk_list *chunk_list_new(void);

/* Appends a chunk. The symbol is src[symbol_start, symbol_end), or none when
 * symbol_src is NULL; `occ` disambiguates chunks sharing path, kind, and
 * symbol. */
cberg_status chunk_list_push(cberg_chunk_list *list, const char *path, cberg_chunk_kind kind, cberg_span span, const char *symbol_src, uint32_t symbol_start, uint32_t symbol_end, uint32_t occ);

/* Each chunker returns a new list in *out_list on success. */

/* Fixed line windows: the fallback for files with no usable structure. */
cberg_status chunk_windows(const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list);

cberg_status chunk_markdown(const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list);

/* lang is YAML, TOML, or JSON. */
cberg_status chunk_config(cberg_language lang, const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list);

#endif /* CBERG_CHUNKER_INTERNAL_H */
