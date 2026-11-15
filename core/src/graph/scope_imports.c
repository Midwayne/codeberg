#include <stdio.h>
#include <string.h>

#include "scope_internal.h"

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

    for (uint32_t i = 0; i < ts_node_named_child_count(node); i++) {
        if (import_name(syntax, ts_node_named_child(node, i), name, out))
            return 1;
    }

    return 0;
}

static int go_import(const graph_syntax *syntax, TSNode node, const char *name, graph_import *out) {
    if (graph_is(node, "import_spec")) {
        char path[CBERG_GRAPH_NAME_MAX];
        if (!graph_text(syntax, graph_field(node, "path"), path, sizeof path))
            return 0;

        size_t length = strlen(path);
        if (length < 2)
            return 0;
        path[length - 1] = '\0';
        const char *module = path + 1;
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

    for (uint32_t i = 0; i < ts_node_named_child_count(node); i++) {
        if (go_import(syntax, ts_node_named_child(node, i), name, out))
            return 1;
    }

    return 0;
}

int graph_import_node(TSNode node) {
    return graph_is(node, "import_declaration") || graph_is(node, "import_statement");
}

static int import_binding(const graph_syntax *syntax, TSNode node, const char *name, graph_import *out, int *found) {
    *found = 0;
    if (syntax->fragment->lang == CBERG_LANG_GO) {
        *found = graph_is(node, "import_declaration") && go_import(syntax, node, name, out);
        return *found;
    }

    if (!graph_is(node, "import_statement") || !import_name(syntax, node, name, out))
        return 0;

    /* The first statement that names it decides, even when its source is unusable. */
    char path[CBERG_GRAPH_NAME_MAX];
    if (!graph_text(syntax, graph_field(node, "source"), path, sizeof path))
        return 1;

    size_t length = strlen(path);
    if (length < 2)
        return 1;

    path[length - 1] = '\0';
    snprintf(out->module, sizeof out->module, "%s", path + 1);
    *found = 1;
    return 1;
}

int graph_find_import(const graph_syntax *syntax, const char *name, graph_import *out) {
    memset(out, 0, sizeof(*out));
    int found = 0;

    const TSNode *imports = NULL;
    size_t count = 0;
    if (graph_root_imports(syntax->cache, syntax->root, &imports, &count)) {
        for (size_t i = 0; i < count; i++) {
            if (import_binding(syntax, imports[i], name, out, &found))
                return found;
        }

        return 0;
    }

    for (uint32_t i = 0; i < ts_node_named_child_count(syntax->root); i++) {
        if (import_binding(syntax, ts_node_named_child(syntax->root, i), name, out, &found))
            return found;
    }

    return 0;
}
