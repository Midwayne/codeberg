/*
 * Graph extraction: turns one parsed file into a cberg_graph_fragment.
 *
 * Definitions are the file's symbol chunks (no second query needed — the
 * chunker already captured them); CONTAINS edges derive from chunk span
 * nesting. References (calls, imports, inheritance, receiver membership) come
 * from small per-language tree-sitter queries over the same parse tree the
 * chunker used, so the graph adds no extra parse pass.
 *
 * Capture vocabulary (per-language node names verified against the vendored
 * grammars):
 *   @call             callee identifier at a call site
 *   @import           import path / module string (quotes stripped)
 *   @inherit          supertype / implemented interface name
 *   @member.container + @member.name
 *                     out-of-body membership (Go receiver methods, Rust impl
 *                     blocks) -> reversed CONTAINS reference
 *   @require.method + @require.path
 *                     Ruby require / require_relative -> IMPORTS
 */
#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <tree_sitter/api.h>

#include "graph_extract.h"

#define GRAPH_LANG_SLOTS ((int)CBERG_LANG_RUBY + 1)

static const char *const GO_REF_QUERY =
    "(identifier) @reference\n(type_identifier) @reference\n(field_identifier) @reference\n"
    "(call_expression function: (identifier) @call)\n"
    "(call_expression function: (selector_expression field: (field_identifier) @call))\n"
    "(import_spec path: (interpreted_string_literal) @import)\n"
    "(method_declaration receiver: (parameter_list (parameter_declaration type: (type_identifier) @member.container)) name: (field_identifier) @member.name)\n"
    "(method_declaration receiver: (parameter_list (parameter_declaration type: (pointer_type (type_identifier) @member.container))) name: (field_identifier) @member.name)\n";

static const char *const C_REF_QUERY =
    "(call_expression function: (identifier) @call)\n"
    "(preproc_include path: (string_literal) @import)\n"
    "(preproc_include path: (system_lib_string) @import)\n";

static const char *const PYTHON_REF_QUERY =
    "(call function: (identifier) @call)\n"
    "(call function: (attribute attribute: (identifier) @call))\n"
    "(import_statement name: (dotted_name) @import)\n"
    "(import_statement name: (aliased_import name: (dotted_name) @import))\n"
    "(import_from_statement module_name: (dotted_name) @import)\n"
    "(import_from_statement module_name: (relative_import) @import)\n"
    "(class_definition superclasses: (argument_list (identifier) @inherit))\n"
    "(class_definition superclasses: (argument_list (attribute attribute: (identifier) @inherit)))\n";

static const char *const JAVASCRIPT_REF_QUERY =
    "(identifier) @reference\n(property_identifier) @reference\n"
    "(call_expression function: (identifier) @call)\n"
    "(call_expression function: (member_expression property: (property_identifier) @call))\n"
    "(new_expression constructor: (identifier) @call)\n"
    "(import_statement source: (string (string_fragment) @import))\n"
    "(class_heritage (identifier) @inherit)\n";

static const char *const TYPESCRIPT_REF_QUERY =
    "(identifier) @reference\n(type_identifier) @reference\n(property_identifier) @reference\n"
    "(call_expression function: (identifier) @call)\n"
    "(call_expression function: (member_expression property: (property_identifier) @call))\n"
    "(new_expression constructor: (identifier) @call)\n"
    "(import_statement source: (string (string_fragment) @import))\n"
    "(extends_clause value: (identifier) @inherit)\n"
    "(implements_clause (type_identifier) @inherit)\n";

static const char *const JAVA_REF_QUERY =
    "(method_invocation name: (identifier) @call)\n"
    "(object_creation_expression type: (type_identifier) @call)\n"
    "(import_declaration (scoped_identifier) @import)\n"
    "(superclass (type_identifier) @inherit)\n"
    "(super_interfaces (type_list (type_identifier) @inherit))\n";

static const char *const KOTLIN_REF_QUERY =
    "(call_expression (simple_identifier) @call)\n"
    "(call_expression (navigation_expression (navigation_suffix (simple_identifier) @call)))\n"
    "(import_header (identifier) @import)\n"
    "(class_declaration (delegation_specifier (constructor_invocation (user_type (type_identifier) @inherit))))\n"
    "(class_declaration (delegation_specifier (user_type (type_identifier) @inherit)))\n";

static const char *const RUST_REF_QUERY =
    "(call_expression function: (identifier) @call)\n"
    "(call_expression function: (scoped_identifier name: (identifier) @call))\n"
    "(call_expression function: (field_expression field: (field_identifier) @call))\n"
    "(macro_invocation macro: (identifier) @call)\n"
    "(use_declaration argument: (_) @import)\n"
    "(impl_item type: (type_identifier) @member.container body: (declaration_list (function_item name: (identifier) @member.name)))\n";

static const char *const RUBY_REF_QUERY =
    "(call method: (identifier) @call)\n"
    "(call method: (identifier) @require.method arguments: (argument_list (string (string_content) @require.path)))\n"
    "(class superclass: (superclass (constant) @inherit))\n";

static const char *ref_query_for(cberg_language lang) {
    switch (lang) {
    case CBERG_LANG_GO:
        return GO_REF_QUERY;
    case CBERG_LANG_C:
        return C_REF_QUERY;
    case CBERG_LANG_PYTHON:
        return PYTHON_REF_QUERY;
    case CBERG_LANG_JAVASCRIPT:
        return JAVASCRIPT_REF_QUERY;
    case CBERG_LANG_TYPESCRIPT:
        return TYPESCRIPT_REF_QUERY;
    case CBERG_LANG_JAVA:
        return JAVA_REF_QUERY;
    case CBERG_LANG_KOTLIN:
        return KOTLIN_REF_QUERY;
    case CBERG_LANG_RUST:
        return RUST_REF_QUERY;
    case CBERG_LANG_RUBY:
        return RUBY_REF_QUERY;
    default:
        return NULL;
    }
}

struct cberg_graph_extractor {
    TSQuery *queries[GRAPH_LANG_SLOTS];
    uint8_t ready[GRAPH_LANG_SLOTS];
};

cberg_graph_extractor *cberg_graph_extractor_new(void) {
    return calloc(1, sizeof(cberg_graph_extractor));
}

void cberg_graph_extractor_free(cberg_graph_extractor *extractor) {
    if (extractor == NULL) {
        return;
    }
    for (int i = 0; i < GRAPH_LANG_SLOTS; i++) {
        if (extractor->queries[i] != NULL) {
            ts_query_delete(extractor->queries[i]);
        }
    }
    free(extractor);
}

static cberg_status ensure_ref_query(cberg_graph_extractor *x, const TSLanguage *ts_lang, cberg_language lang, TSQuery **out_query) {
    int slot = (int)lang;
    if (slot <= CBERG_LANG_UNKNOWN || slot >= GRAPH_LANG_SLOTS) {
        *out_query = NULL;
        return CBERG_OK;
    }
    if (!x->ready[slot]) {
        const char *src = ref_query_for(lang);
        if (src != NULL) {
            uint32_t err_offset = 0;
            TSQueryError err_type = TSQueryErrorNone;
            x->queries[slot] = ts_query_new(ts_lang, src, (uint32_t)strlen(src), &err_offset, &err_type);
            if (x->queries[slot] == NULL) {
                return CBERG_ERR_INTERNAL;
            }
        }
        x->ready[slot] = 1;
    }
    *out_query = x->queries[slot];
    return CBERG_OK;
}

cberg_status cberg_graph_extract(cberg_graph_extractor *extractor, const TSLanguage *ts_lang, cberg_language lang, TSNode root, const char *path, const char *src, size_t src_len, const cberg_chunk_list *chunks, cberg_graph_fragment **out_fragment) {
    if (extractor == NULL || path == NULL || src == NULL || out_fragment == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_fragment = NULL;

    cberg_graph_fragment *frag = graph_fragment_new(path, lang);
    if (frag == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = graph_fragment_add_defs(frag, chunks);

    TSQuery *query = NULL;
    if (st == CBERG_OK) {
        st = ensure_ref_query(extractor, ts_lang, lang, &query);
    }
    if (st == CBERG_OK && query != NULL) {
        st = graph_walk_refs(frag, query, root, src, src_len);
    }

    if (st != CBERG_OK) {
        cberg_graph_fragment_free(frag);
        return st;
    }
    *out_fragment = frag;
    return CBERG_OK;
}
