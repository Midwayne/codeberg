/* Internal to graph extraction: graph_extract.c (entry point), graph_fragment.c
 * (definitions and nesting), and graph_refs.c (the reference walk). */
#ifndef CBERG_GRAPH_EXTRACT_H
#define CBERG_GRAPH_EXTRACT_H

#include <stdint.h>

#include <tree_sitter/api.h>

#include "graph_internal.h"

/* Returns a new, empty fragment for path, or NULL when out of memory. */
cberg_graph_fragment *graph_fragment_new(const char *path, cberg_language lang);

/* Adds a definition per symbol chunk and their span-nesting CONTAINS edges. */
cberg_status graph_fragment_add_defs(cberg_graph_fragment *frag, const cberg_chunk_list *chunks);

/* Appends one reference; name is copied into the fragment's arena. */
cberg_status graph_fragment_push_ref(cberg_graph_fragment *frag, int32_t src_def, int32_t dst_def, const char *name, uint32_t line, uint8_t kind, uint8_t rev);

/* Index of the innermost definition containing byte pos, or -1 for none. */
int32_t graph_fragment_enclosing_def(const cberg_graph_fragment *frag, uint32_t pos);

/* Runs the reference query over root and appends the references it finds. */
cberg_status graph_walk_refs(cberg_graph_fragment *frag, const TSQuery *query, TSNode root, const char *src, size_t src_len);

#endif
