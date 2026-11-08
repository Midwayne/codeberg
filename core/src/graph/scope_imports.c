#include <stdio.h>
#include <string.h>

#include "scope_internal.h"

/* Tree-sitter string literals keep their quotes. Drop the outer pair. */
static const char *unquote(char *text) {
    size_t length = strlen(text);
    if (length < 2) {
        return NULL;
    }

    text[length - 1] = '\0';

    return text + 1;
}

static int each_named(
    const graph_syntax *syntax,
    TSNode node,
    const char *name,
    graph_import *out,
    int (*match)(const graph_syntax *, TSNode, const char *, graph_import *)) {
    for (uint32_t i = 0; i < ts_node_named_child_count(node); i++) {
        if (match(syntax, ts_node_named_child(node, i), name, out)) {
            return 1;
        }
    }

    return 0;
}

static int import_name(const graph_syntax *syntax, TSNode node, const char *name, graph_import *out) {
    if (graph_is(node, "import_specifier")) {
        TSNode original = graph_field(node, "name");
        TSNode alias = graph_field(node, "alias");
        if (!graph_name_is(syntax, ts_node_is_null(alias) ? original : alias, name))
            return 0;

        out->namespace = 0;
        return graph_text(syntax, original, out->name, sizeof out->name);
    }

    if (graph_is(node, "namespace_import")) {
        TSNode alias = ts_node_named_child(node, 0);
        if (!graph_name_is(syntax, alias, name))
            return 0;

        out->namespace = 1;
        return 1;
    }

    /* Default imports remain explicitly bound, but need export analysis before
     * they can identify a declaration. Never guess from the local alias. */
    if (graph_is(node, "import_clause")) {
        TSNode first = ts_node_named_child(node, 0);
        if (graph_is(first, "identifier") && graph_name_is(syntax, first, name)) {
            snprintf(out->name, sizeof out->name, "default");
            return 1;
        }
    }

    return each_named(syntax, node, name, out, import_name);
}

static int go_import(const graph_syntax *syntax, TSNode node, const char *name, graph_import *out) {
    if (graph_is(node, "import_spec")) {
        char path[CBERG_GRAPH_NAME_MAX];
        if (!graph_text(syntax, graph_field(node, "path"), path, sizeof path))
            return 0;

        const char *module = unquote(path);
        if (module == NULL) {
            return 0;
        }
        const char *base = strrchr(module, '/');
        TSNode alias = graph_field(node, "name");
        int matches = ts_node_is_null(alias) ? strcmp(base != NULL ? base + 1 : module, name) == 0
                                             : graph_name_is(syntax, alias, name);
        if (!matches)
            return 0;

        snprintf(out->module, sizeof out->module, "%s", module);
        out->namespace = 1;
        return 1;
    }

    return each_named(syntax, node, name, out, go_import);
}

int graph_find_import(const graph_syntax *syntax, const char *name, graph_import *out) {
    memset(out, 0, sizeof(*out));
    for (uint32_t i = 0; i < ts_node_named_child_count(syntax->root); i++) {
        TSNode node = ts_node_named_child(syntax->root, i);
        if (syntax->fragment->lang == CBERG_LANG_GO) {
            if (graph_is(node, "import_declaration") && go_import(syntax, node, name, out))
                return 1;
        } else if (graph_is(node, "import_statement") && import_name(syntax, node, name, out)) {
            char path[CBERG_GRAPH_NAME_MAX];
            if (!graph_text(syntax, graph_field(node, "source"), path, sizeof path))
                return 0;

            const char *module = unquote(path);
            if (module == NULL) {
                return 0;
            }
            snprintf(out->module, sizeof out->module, "%s", module);
            return 1;
        }
    }

    return 0;
}
