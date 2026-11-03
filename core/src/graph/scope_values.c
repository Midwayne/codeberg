#include <stdio.h>
#include <string.h>

#include "scope_internal.h"

static int declaration_names(const graph_syntax *syntax, TSNode node, const char *name) {
    TSNode declarator = graph_field(node, "declarator");
    while (!ts_node_is_null(declarator)) {
        if (graph_name_is(syntax, declarator, name))
            return 1;
        declarator = graph_is(declarator, "parenthesized_declarator") ? ts_node_named_child(declarator, 0) : graph_field(declarator, "declarator");
    }

    uint32_t count = ts_node_child_count(node);
    for (uint32_t i = 0; i < count; i++) {
        const char *field = ts_node_field_name_for_child(node, i);
        if (field == NULL || (strcmp(field, "name") != 0 && strcmp(field, "pattern") != 0))
            continue;
        if (graph_name_is(syntax, ts_node_child(node, i), name))
            return 1;
    }

    return 0;
}

static int declaration_value(const graph_syntax *syntax, TSNode node, const char *name, TSNode *type) {
    if (graph_is(node, "identifier") && (graph_is(ts_node_parent(node), "formal_parameters") || graph_is(ts_node_parent(node), "parameters")) &&
        graph_name_is(syntax, node, name)) {
        *type = (TSNode){0};
        return 1;
    }

    if (graph_is(node, "variable_declarator") || graph_is(node, "required_parameter") ||
        graph_is(node, "optional_parameter") || graph_is(node, "parameter_declaration") ||
        graph_is(node, "var_spec")) {
        if (!declaration_names(syntax, node, name))
            return 0;

        *type = graph_field(node, "type");
        if (ts_node_is_null(*type))
            *type = graph_field(node, "value");
        return 1;
    }

    if (graph_is(node, "short_var_declaration")) {
        TSNode left = graph_field(node, "left");
        TSNode right = graph_field(node, "right");
        uint32_t count = ts_node_named_child_count(left);
        for (uint32_t i = 0; i < count; i++) {
            if (graph_name_is(syntax, ts_node_named_child(left, i), name)) {
                *type = i < ts_node_named_child_count(right) ? ts_node_named_child(right, i) : (TSNode){0};
                return 1;
            }
        }
    }

    return 0;
}

static int find_declaration(const graph_syntax *syntax, TSNode node, const char *name, uint32_t position, TSNode *declaration, TSNode *type) {
    if (graph_scope_node(node))
        return 0;
    int future = ts_node_start_byte(node) >= position;
    if (future && (syntax->fragment->lang == CBERG_LANG_GO || syntax->fragment->lang == CBERG_LANG_C ||
                   syntax->fragment->lang == CBERG_LANG_PYTHON))
        return 0;

    if (declaration_value(syntax, node, name, type)) {
        *declaration = node;
        /* JS/TS lexical declarations shadow the entire block, but their value
         * cannot identify a receiver before initialization. */
        if (future)
            *type = (TSNode){0};
        return 1;
    }

    /* Search backwards so the nearest preceding declaration wins. Scope nodes
     * are boundaries: declarations inside sibling functions/blocks are hidden. */
    uint32_t count = ts_node_named_child_count(node);
    for (uint32_t i = count; i > 0; i--) {
        if (find_declaration(syntax, ts_node_named_child(node, i - 1), name, position, declaration, type))
            return 1;
    }

    return 0;
}

int graph_find_value(const graph_syntax *syntax, TSNode reference, const char *name, TSNode *declaration, TSNode *type) {
    uint32_t position = ts_node_start_byte(reference);
    for (TSNode scope = reference; !ts_node_is_null(scope); scope = ts_node_parent(scope)) {
        if (!graph_scope_node(scope))
            continue;

        uint32_t count = ts_node_named_child_count(scope);
        for (uint32_t i = count; i > 0; i--) {
            if (find_declaration(syntax, ts_node_named_child(scope, i - 1), name, position, declaration, type))
                return 1;
        }

        /* A definition in this scope hides values from enclosing scopes. */
        if (graph_definition_in_scope(syntax, scope, name) >= 0)
            return 0;
    }

    return 0;
}

void graph_type_binding(const graph_syntax *syntax, TSNode type, cberg_graph_binding *out) {
    if (ts_node_is_null(type))
        return;

    if (graph_is(type, "type_annotation") || graph_is(type, "pointer_type") ||
        graph_is(type, "parenthesized_type") || graph_is(type, "expression_list")) {
        graph_type_binding(syntax, ts_node_named_child(type, 0), out);
        return;
    }

    if (graph_is(type, "new_expression")) {
        graph_type_binding(syntax, graph_field(type, "constructor"), out);
        return;
    }

    if (graph_is(type, "composite_literal")) {
        graph_type_binding(syntax, graph_field(type, "type"), out);
        return;
    }

    if (graph_is(type, "unary_expression")) {
        graph_type_binding(syntax, graph_field(type, "operand"), out);
        return;
    }

    if (graph_is(type, "qualified_type") || graph_is(type, "nested_type_identifier") ||
        graph_is(type, "member_expression")) {
        TSNode qualifier = graph_field(type, "package");
        if (ts_node_is_null(qualifier))
            qualifier = graph_field(type, "module");
        if (ts_node_is_null(qualifier))
            qualifier = graph_field(type, "object");
        TSNode name = graph_field(type, "name");
        if (ts_node_is_null(name))
            name = graph_field(type, "property");

        char alias[CBERG_GRAPH_NAME_MAX];
        graph_import imported;
        if (graph_text(syntax, qualifier, alias, sizeof alias) && graph_find_import(syntax, alias, &imported)) {
            snprintf(out->module, sizeof out->module, "%s", imported.module);
            graph_text(syntax, name, out->owner, sizeof out->owner);
        }
        return;
    }

    if (graph_is(type, "type_identifier") || graph_is(type, "identifier")) {
        if (!graph_text(syntax, type, out->owner, sizeof out->owner))
            return;

        int32_t definition = graph_visible_definition(syntax, type, out->owner);
        if (definition >= 0) {
            cberg_chunk_kind kind = syntax->fragment->defs[definition].kind;
            if (kind == CBERG_CHUNK_CLASS || kind == CBERG_CHUNK_STRUCT || kind == CBERG_CHUNK_INTERFACE)
                return;
        }

        graph_import imported;
        if (graph_find_import(syntax, out->owner, &imported)) {
            snprintf(out->module, sizeof out->module, "%s", imported.module);
            snprintf(out->owner, sizeof out->owner, "%s", imported.name);
        }
    }
}
