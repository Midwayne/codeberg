#include "graph_names.h"

#include <stddef.h>
#include <strings.h>

typedef struct {
    const char *name;
    uint32_t value;
} name_row;

#define ROWS(table) (sizeof(table) / sizeof((table)[0]))

static const name_row k_node_kinds[] = {
    {"file", CBERG_GNODE_FILE},
    {"function", CBERG_GNODE_FUNCTION},
    {"method", CBERG_GNODE_METHOD},
    {"class", CBERG_GNODE_CLASS},
    {"struct", CBERG_GNODE_STRUCT},
    {"interface", CBERG_GNODE_INTERFACE},
    {"module", CBERG_GNODE_MODULE},
};

static const name_row k_edge_kinds[] = {
    {"defines", CBERG_GEDGE_DEFINES},
    {"contains", CBERG_GEDGE_CONTAINS},
    {"imports", CBERG_GEDGE_IMPORTS},
    {"calls", CBERG_GEDGE_CALLS},
    {"inherits", CBERG_GEDGE_INHERITS},
    {"references", CBERG_GEDGE_REFERENCES},
};

static const name_row k_resolutions[] = {
    {"textual", CBERG_GRES_TEXTUAL},
    {"import", CBERG_GRES_IMPORT},
    {"typed", CBERG_GRES_TYPED},
};

_Static_assert(ROWS(k_node_kinds) == (size_t)CBERG_GNODE_MODULE + 1, "name every cberg_graph_node_kind");
_Static_assert((1u << ROWS(k_edge_kinds)) - 1u == CBERG_GEDGE_ALL, "name every cberg_graph_edge_kind");

static const char *name_of(const name_row *rows, size_t n, uint32_t value) {
    for (size_t i = 0; i < n; i++) {
        if (rows[i].value == value) {
            return rows[i].name;
        }
    }
    return "unknown";
}

static const name_row *row_named(const name_row *rows, size_t n, const char *s) {
    if (s == NULL || s[0] == '\0') {
        return NULL;
    }
    for (size_t i = 0; i < n; i++) {
        if (strcasecmp(s, rows[i].name) == 0) {
            return &rows[i];
        }
    }
    return NULL;
}

const char *cberg_graph_node_kind_name(cberg_graph_node_kind kind) {
    return name_of(k_node_kinds, ROWS(k_node_kinds), (uint32_t)kind);
}

const char *cberg_graph_edge_kind_name(cberg_graph_edge_kind kind) {
    return name_of(k_edge_kinds, ROWS(k_edge_kinds), (uint32_t)kind);
}

const char *cberg_graph_resolution_name(cberg_graph_resolution resolution) {
    return name_of(k_resolutions, ROWS(k_resolutions), (uint32_t)resolution);
}

uint32_t cberg_graph_node_mask_parse(const char *s) {
    if (s != NULL && strcasecmp(s, "symbol") == 0) {
        return CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION) | CBERG_GNODE_MASK(CBERG_GNODE_METHOD) |
               CBERG_GNODE_MASK(CBERG_GNODE_CLASS) | CBERG_GNODE_MASK(CBERG_GNODE_STRUCT) |
               CBERG_GNODE_MASK(CBERG_GNODE_INTERFACE);
    }

    const name_row *row = row_named(k_node_kinds, ROWS(k_node_kinds), s);
    return row != NULL ? CBERG_GNODE_MASK(row->value) : 0;
}

uint32_t cberg_graph_edge_mask_parse(const char *s) {
    if (s != NULL && strcasecmp(s, "all") == 0) {
        return CBERG_GEDGE_ALL;
    }

    const name_row *row = row_named(k_edge_kinds, ROWS(k_edge_kinds), s);
    return row != NULL ? row->value : 0;
}
