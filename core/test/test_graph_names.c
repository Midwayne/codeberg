#include "codeberg/codeberg.h"
#include "graph_names.h"

#include <stdio.h>
#include <string.h>

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

static void check_node_kinds(void) {
    for (int k = CBERG_GNODE_FILE; k <= CBERG_GNODE_MODULE; k++) {
        const char *name = cberg_graph_node_kind_name((cberg_graph_node_kind)k);
        CHECK(strcmp(name, "unknown") != 0, "every node kind has a name");
        CHECK(cberg_graph_node_mask_parse(name) == CBERG_GNODE_MASK(k), "node names round-trip");
    }

    CHECK(strcmp(cberg_graph_node_kind_name(CBERG_GNODE_MODULE), "module") == 0, "module name");
    CHECK(cberg_graph_node_mask_parse("CLASS") == CBERG_GNODE_MASK(CBERG_GNODE_CLASS), "node parse ignores case");

    uint32_t symbol = cberg_graph_node_mask_parse("symbol");
    CHECK((symbol & CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION)) != 0, "symbol includes functions");
    CHECK((symbol & CBERG_GNODE_MASK(CBERG_GNODE_FILE)) == 0, "symbol excludes files");
    CHECK((symbol & CBERG_GNODE_MASK(CBERG_GNODE_MODULE)) == 0, "symbol excludes modules");

    CHECK(cberg_graph_node_mask_parse(NULL) == 0, "NULL node kind");
    CHECK(cberg_graph_node_mask_parse("") == 0, "empty node kind");
    CHECK(cberg_graph_node_mask_parse("widget") == 0, "unknown node kind");
}

static void check_edge_kinds(void) {
    for (uint32_t bit = 1; bit <= CBERG_GEDGE_REFERENCES; bit <<= 1) {
        const char *name = cberg_graph_edge_kind_name((cberg_graph_edge_kind)bit);
        CHECK(strcmp(name, "unknown") != 0, "every edge kind has a name");
        CHECK(cberg_graph_edge_mask_parse(name) == bit, "edge names round-trip");
    }

    CHECK(strcmp(cberg_graph_edge_kind_name(CBERG_GEDGE_CALLS), "calls") == 0, "calls name");
    CHECK(cberg_graph_edge_mask_parse("all") == CBERG_GEDGE_ALL, "all edges");
    CHECK(cberg_graph_edge_mask_parse("") == 0, "empty edge kind");
    CHECK(strcmp(cberg_graph_edge_kind_name((cberg_graph_edge_kind)(1u << 9)), "unknown") == 0, "unknown edge kind");
}

static void check_resolutions(void) {
    CHECK(strcmp(cberg_graph_resolution_name(CBERG_GRES_TEXTUAL), "textual") == 0, "textual");
    CHECK(strcmp(cberg_graph_resolution_name(CBERG_GRES_IMPORT), "import") == 0, "import");
    CHECK(strcmp(cberg_graph_resolution_name(CBERG_GRES_TYPED), "typed") == 0, "typed");
}

int main(void) {
    check_node_kinds();
    check_edge_kinds();
    check_resolutions();
    return failures == 0 ? 0 : 1;
}
