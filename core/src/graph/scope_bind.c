#include <stdio.h>
#include <string.h>

#include "scope_internal.h"

static void bind_identifier(const graph_syntax *syntax, TSNode reference, cberg_graph_binding *out) {
    TSNode declaration = {0}, type = {0};
    int value = graph_find_value(syntax, reference, out->name, &declaration, &type);
    int32_t definition = graph_visible_definition(syntax, reference, out->name);
    if (value) {
        out->kind = CBERG_BIND_UNKNOWN;
        /* A parameter or local value shadows imports and package definitions.
         * Only a function chunk inside that declaration is callable by identity. */
        if (definition >= 0 && ts_node_start_byte(declaration) < ts_node_start_byte(reference)) {
            const cberg_span *span = &syntax->fragment->defs[definition].span;
            if (span->start_byte >= ts_node_start_byte(declaration) && span->end_byte <= ts_node_end_byte(declaration)) {
                out->local_def = definition;
                out->kind = CBERG_BIND_LOCAL;
            }
        }
        return;
    }

    if (definition >= 0) {
        out->local_def = definition;
        out->kind = CBERG_BIND_LOCAL;
        return;
    }

    graph_import imported;
    if (graph_find_import(syntax, out->name, &imported) && !imported.namespace) {
        snprintf(out->module, sizeof out->module, "%s", imported.module);
        snprintf(out->name, sizeof out->name, "%s", imported.name);
        out->kind = CBERG_BIND_IMPORT;
        return;
    }

    if (syntax->fragment->lang == CBERG_LANG_GO)
        out->kind = CBERG_BIND_PACKAGE;
}

static void bind_this(const graph_syntax *syntax, TSNode reference, cberg_graph_binding *out) {
    for (TSNode node = reference; !ts_node_is_null(node); node = ts_node_parent(node)) {
        /* Arrow functions inherit this; ordinary nested functions do not. */
        if (graph_is(node, "function_declaration") || graph_is(node, "function_expression") ||
            graph_is(node, "generator_function") || graph_is(node, "generator_function_declaration"))
            return;
        if (graph_is(node, "method_definition") && !graph_is(ts_node_parent(node), "class_body"))
            return;

        if (graph_is(node, "class_declaration") || graph_is(node, "class_definition") || graph_is(node, "class")) {
            if (graph_text(syntax, graph_field(node, "name"), out->owner, sizeof out->owner)) {
                out->kind = CBERG_BIND_MEMBER;
            }
            return;
        }
    }
}

static void bind_receiver(const graph_syntax *syntax, TSNode reference, TSNode receiver, cberg_graph_binding *out) {
    if (graph_is(receiver, "this") || (syntax->fragment->lang == CBERG_LANG_PYTHON && graph_name_is(syntax, receiver, "self"))) {
        bind_this(syntax, reference, out);
        return;
    }

    char alias[CBERG_GRAPH_NAME_MAX];
    if (!graph_text(syntax, receiver, alias, sizeof alias))
        return;

    TSNode declaration = {0}, type = {0};
    if (graph_find_value(syntax, reference, alias, &declaration, &type)) {
        graph_type_binding(syntax, type, out);
        if (out->owner[0] != '\0')
            out->kind = out->module[0] ? CBERG_BIND_IMPORT : CBERG_BIND_MEMBER;
        return;
    }

    /* A class name is a known static receiver and can shadow an import. */
    int32_t definition = graph_visible_definition(syntax, reference, alias);
    if (definition >= 0) {
        if (syntax->fragment->defs[definition].kind == CBERG_CHUNK_CLASS) {
            snprintf(out->owner, sizeof out->owner, "%s", alias);
            out->kind = CBERG_BIND_MEMBER;
        }
        return;
    }

    graph_import imported;
    if (graph_find_import(syntax, alias, &imported)) {
        snprintf(out->module, sizeof out->module, "%s", imported.module);
        if (!imported.namespace)
            snprintf(out->owner, sizeof out->owner, "%s", imported.name);
        out->kind = CBERG_BIND_IMPORT;
    }
}

void cberg_graph_bind_call(const cberg_graph_fragment *fragment, TSNode root, TSNode reference, const char *source, size_t length, cberg_graph_binding *out) {
    *out = (cberg_graph_binding){.local_def = -1, .kind = CBERG_BIND_LEGACY};
    graph_syntax syntax = {.fragment = fragment, .root = root, .source = source, .length = length};
    if (!graph_text(&syntax, reference, out->name, sizeof out->name))
        return;

    int lexical_legacy = fragment->lang == CBERG_LANG_C || fragment->lang == CBERG_LANG_PYTHON;
    if (!lexical_legacy && fragment->lang != CBERG_LANG_GO && fragment->lang != CBERG_LANG_TYPESCRIPT &&
        fragment->lang != CBERG_LANG_JAVASCRIPT)
        return;

    out->kind = CBERG_BIND_UNKNOWN;
    TSNode parent = ts_node_parent(reference);
    TSNode receiver = {0};
    if (graph_is(parent, "member_expression"))
        receiver = graph_field(parent, "object");
    if (graph_is(parent, "selector_expression"))
        receiver = graph_field(parent, "operand");
    if (fragment->lang == CBERG_LANG_PYTHON && graph_is(parent, "attribute"))
        receiver = graph_field(parent, "object");

    if (!ts_node_is_null(receiver)) {
        bind_receiver(&syntax, reference, receiver, out);
    } else {
        if (lexical_legacy)
            out->kind = CBERG_BIND_LEGACY;
        bind_identifier(&syntax, reference, out);
    }
}
