#include <string.h>

#include "scope_internal.h"

TSNode graph_field(TSNode node, const char *name) {
    if (ts_node_is_null(node))
        return (TSNode){0};

    return ts_node_child_by_field_name(node, name, (uint32_t)strlen(name));
}

int graph_is(TSNode node, const char *type) {
    return !ts_node_is_null(node) && strcmp(ts_node_type(node), type) == 0;
}

int graph_text(const graph_syntax *syntax, TSNode node, char *out, size_t capacity) {
    if (ts_node_is_null(node))
        return 0;

    uint32_t start = ts_node_start_byte(node), end = ts_node_end_byte(node);
    if (end > syntax->length || start >= end || end - start >= capacity)
        return 0;

    memcpy(out, syntax->source + start, end - start);
    out[end - start] = '\0';
    return 1;
}

int graph_name_is(const graph_syntax *syntax, TSNode node, const char *name) {
    char text[CBERG_GRAPH_NAME_MAX];
    return graph_text(syntax, node, text, sizeof text) && strcmp(text, name) == 0;
}

int graph_scope_node(TSNode node) {
    return graph_is(node, "program") || graph_is(node, "source_file") ||
           graph_is(node, "module") || graph_is(node, "translation_unit") ||
           graph_is(node, "function_definition") || graph_is(node, "compound_statement") ||
           graph_is(node, "class_definition") ||
           graph_is(node, "statement_block") || graph_is(node, "block") ||
           graph_is(node, "function_declaration") || graph_is(node, "function_expression") ||
           graph_is(node, "function_item") || graph_is(node, "arrow_function") ||
           graph_is(node, "func_literal") || graph_is(node, "generator_function") ||
           graph_is(node, "generator_function_declaration") ||
           graph_is(node, "method_definition") || graph_is(node, "method_declaration") ||
           graph_is(node, "class_declaration") || graph_is(node, "class_body");
}

int cberg_graph_reference_use(TSNode reference) {
    TSNode parent = ts_node_parent(reference);
    TSNode expression = reference;
    if (graph_is(parent, "member_expression") || graph_is(parent, "selector_expression")) {
        expression = parent;
    }

    TSNode call = ts_node_parent(expression);
    if ((graph_is(call, "call_expression") && ts_node_eq(graph_field(call, "function"), expression)) ||
        (graph_is(call, "new_expression") && ts_node_eq(graph_field(call, "constructor"), expression)))
        return 0;

    /* Declaration names, import bindings and object keys are not usages. */
    if (ts_node_eq(graph_field(parent, "name"), reference) ||
        ts_node_eq(graph_field(parent, "pattern"), reference) ||
        ts_node_eq(graph_field(parent, "key"), reference) ||
        ts_node_eq(graph_field(parent, "left"), reference))
        return 0;
    if (graph_is(parent, "package_clause") || graph_is(parent, "type_parameters"))
        return 0;
    if ((graph_is(reference, "property_identifier") || graph_is(reference, "field_identifier")) &&
        !graph_is(parent, "member_expression") && !graph_is(parent, "selector_expression"))
        return 0;

    for (TSNode node = parent; !ts_node_is_null(node); node = ts_node_parent(node)) {
        if (graph_is(node, "import_statement") || graph_is(node, "import_declaration"))
            return 0;
    }

    return 1;
}

static TSNode lexical_scope(TSNode node) {
    for (TSNode parent = ts_node_parent(node); !ts_node_is_null(parent); parent = ts_node_parent(parent)) {
        if (graph_scope_node(parent))
            return parent;
    }

    return (TSNode){0};
}

int32_t graph_definition_in_scope(const graph_syntax *syntax, TSNode scope, const char *name) {
    const cberg_graph_fragment *fragment = syntax->fragment;
    for (size_t i = 0; i < fragment->defs_len; i++) {
        const cberg_graph_fdef *definition = &fragment->defs[i];
        if (strcmp(definition->name, name) != 0 || definition->kind == CBERG_CHUNK_METHOD)
            continue;

        TSNode node = ts_node_named_descendant_for_byte_range(syntax->root, definition->span.start_byte, definition->span.end_byte);
        if (ts_node_eq(lexical_scope(node), scope))
            return (int32_t)i;
    }

    return -1;
}

int32_t graph_visible_definition(const graph_syntax *syntax, TSNode reference, const char *name) {
    for (TSNode scope = reference; !ts_node_is_null(scope); scope = ts_node_parent(scope)) {
        if (!graph_scope_node(scope))
            continue;

        int32_t definition = graph_definition_in_scope(syntax, scope, name);
        if (definition >= 0)
            return definition;
    }

    return -1;
}
