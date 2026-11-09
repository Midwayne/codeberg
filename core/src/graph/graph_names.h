#ifndef CBERG_GRAPH_NAMES_H
#define CBERG_GRAPH_NAMES_H

#include <stdint.h>

#include "codeberg/codeberg.h"

/*
 * Wire names for the graph enums in codeberg.h, kept beside them so a new
 * kind gets its name in the same change. Names are lower-case; parsing is
 * case-insensitive. Unknown values print as "unknown".
 */
const char *cberg_graph_node_kind_name(cberg_graph_node_kind kind);
const char *cberg_graph_edge_kind_name(cberg_graph_edge_kind kind);
const char *cberg_graph_resolution_name(cberg_graph_resolution resolution);

/* A node kind name, or "symbol" for every non-file, non-module kind, as a
 * CBERG_GNODE_MASK set. 0 for NULL, "", or an unknown name. */
uint32_t cberg_graph_node_mask_parse(const char *s);

/* An edge kind name, or "all", as an edge-kind bit set. 0 for NULL, "", or an
 * unknown name. */
uint32_t cberg_graph_edge_mask_parse(const char *s);

#endif /* CBERG_GRAPH_NAMES_H */
