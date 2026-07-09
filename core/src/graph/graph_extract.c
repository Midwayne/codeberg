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

#include "arena.h"
#include "graph_internal.h"
#include "grow.h"
#include "strmap.h"

#define GRAPH_LANG_SLOTS ((int)CBERG_LANG_RUBY + 1)

static const char *const GO_REF_QUERY =
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
    "(call_expression function: (identifier) @call)\n"
    "(call_expression function: (member_expression property: (property_identifier) @call))\n"
    "(new_expression constructor: (identifier) @call)\n"
    "(import_statement source: (string (string_fragment) @import))\n"
    "(class_heritage (identifier) @inherit)\n";

static const char *const TYPESCRIPT_REF_QUERY =
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

/* ---------------------------------------------------------- fragment build */

static cberg_graph_fragment *fragment_new(const char *path, cberg_language lang) {
    cberg_graph_fragment *frag = calloc(1, sizeof(*frag));
    if (frag == NULL) {
        return NULL;
    }
    frag->arena = cberg_arena_new();
    if (frag->arena == NULL) {
        free(frag);
        return NULL;
    }
    frag->path = cberg_arena_strdup(frag->arena, path);
    if (frag->path == NULL) {
        cberg_graph_fragment_free(frag);
        return NULL;
    }
    frag->lang = lang;
    return frag;
}

const char *cberg_graph_fragment_path(const cberg_graph_fragment *fragment) {
    return fragment == NULL ? NULL : fragment->path;
}

void cberg_graph_fragment_free(cberg_graph_fragment *fragment) {
    if (fragment == NULL) {
        return;
    }
    cberg_arena_free(fragment->arena);
    free(fragment->defs);
    free(fragment->refs);
    free(fragment);
}

static cberg_status fragment_push_def(cberg_graph_fragment *frag, const cberg_chunk *chunk) {
    size_t cap = cberg_grow_cap(frag->defs_cap, frag->defs_len + 1, 16);
    if (cap != frag->defs_cap) {
        cberg_graph_fdef *grown = realloc(frag->defs, cap * sizeof(*grown));
        if (grown == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        frag->defs = grown;
        frag->defs_cap = cap;
    }
    const char *key = cberg_arena_strdup(frag->arena, chunk->key);
    const char *name = cberg_arena_strdup(frag->arena, chunk->symbol);
    if (key == NULL || name == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    frag->defs[frag->defs_len++] = (cberg_graph_fdef){
        .key = key,
        .name = name,
        .kind = chunk->kind,
        .span = chunk->span,
    };
    return CBERG_OK;
}

static cberg_status fragment_push_ref(cberg_graph_fragment *frag, int32_t src_def, int32_t dst_def, const char *name, uint32_t line, uint8_t kind, uint8_t rev) {
    size_t cap = cberg_grow_cap(frag->refs_cap, frag->refs_len + 1, 32);
    if (cap != frag->refs_cap) {
        cberg_graph_fref *grown = realloc(frag->refs, cap * sizeof(*grown));
        if (grown == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        frag->refs = grown;
        frag->refs_cap = cap;
    }
    const char *name_copy = NULL;
    if (name != NULL) {
        name_copy = cberg_arena_strdup(frag->arena, name);
        if (name_copy == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    frag->refs[frag->refs_len++] = (cberg_graph_fref){
        .src_def = src_def,
        .dst_def = dst_def,
        .name = name_copy,
        .line = line,
        .kind = kind,
        .rev = rev,
    };
    return CBERG_OK;
}

static int def_is_symbol(cberg_chunk_kind kind) {
    switch (kind) {
    case CBERG_CHUNK_FUNCTION:
    case CBERG_CHUNK_METHOD:
    case CBERG_CHUNK_CLASS:
    case CBERG_CHUNK_STRUCT:
    case CBERG_CHUNK_INTERFACE:
        return 1;
    default:
        return 0;
    }
}

static int def_is_container(cberg_chunk_kind kind) {
    return kind == CBERG_CHUNK_CLASS || kind == CBERG_CHUNK_STRUCT || kind == CBERG_CHUNK_INTERFACE;
}

/* Smallest definition whose span contains byte `pos`, or -1 (file scope). */
static int32_t enclosing_def(const cberg_graph_fragment *frag, uint32_t pos) {
    int32_t best = -1;
    uint32_t best_size = UINT32_MAX;
    for (size_t i = 0; i < frag->defs_len; i++) {
        const cberg_span *s = &frag->defs[i].span;
        if (s->start_byte <= pos && pos < s->end_byte && s->end_byte - s->start_byte < best_size) {
            best = (int32_t)i;
            best_size = s->end_byte - s->start_byte;
        }
    }
    return best;
}

/* CONTAINS from chunk nesting: link each definition to its smallest strictly
 * enclosing container definition (nested classes, methods in class bodies). */
static cberg_status fragment_add_nesting(cberg_graph_fragment *frag) {
    for (size_t i = 0; i < frag->defs_len; i++) {
        const cberg_span *child = &frag->defs[i].span;
        int32_t parent = -1;
        uint32_t parent_size = UINT32_MAX;
        for (size_t j = 0; j < frag->defs_len; j++) {
            if (i == j || !def_is_container(frag->defs[j].kind)) {
                continue;
            }
            const cberg_span *outer = &frag->defs[j].span;
            uint32_t size = outer->end_byte - outer->start_byte;
            if (outer->start_byte <= child->start_byte && child->end_byte <= outer->end_byte &&
                size > child->end_byte - child->start_byte && size < parent_size) {
                parent = (int32_t)j;
                parent_size = size;
            }
        }
        if (parent >= 0) {
            cberg_status st = fragment_push_ref(frag, parent, (int32_t)i, NULL, child->start_line, CBERG_GEDGE_CONTAINS, 0);
            if (st != CBERG_OK) {
                return st;
            }
        }
    }
    return CBERG_OK;
}

/* -------------------------------------------------------------- reference walk */

/* Copies a capture's text, truncated to CBERG_GRAPH_NAME_MAX. For imports,
 * strips one layer of quotes / angle brackets and trims rust use-tree braces
 * ("x::{a, b}" -> "x"). */
static void capture_text(const char *src, size_t src_len, TSNode node, int is_import, char *buf, size_t buf_cap) {
    uint32_t start = ts_node_start_byte(node);
    uint32_t end = ts_node_end_byte(node);
    if (end > src_len || start > end) {
        buf[0] = '\0';
        return;
    }
    if (is_import && end - start >= 2) {
        char open = src[start];
        char close = src[end - 1];
        if ((open == '"' && close == '"') || (open == '\'' && close == '\'') || (open == '<' && close == '>')) {
            start++;
            end--;
        }
    }
    size_t len = end - start;
    if (len >= buf_cap) {
        len = buf_cap - 1;
    }
    memcpy(buf, src + start, len);
    buf[len] = '\0';
    if (is_import) {
        char *brace = strchr(buf, '{');
        if (brace != NULL) {
            while (brace > buf && (brace[-1] == ':' || brace[-1] == ' ')) {
                brace--;
            }
            *brace = '\0';
        }
    }
}

typedef enum ref_capture {
    CAP_NONE = 0,
    CAP_CALL,
    CAP_IMPORT,
    CAP_INHERIT,
    CAP_MEMBER_CONTAINER,
    CAP_MEMBER_NAME,
    CAP_REQUIRE_METHOD,
    CAP_REQUIRE_PATH,
} ref_capture;

static ref_capture capture_kind(const char *name, uint32_t len) {
    struct {
        const char *name;
        ref_capture kind;
    } kinds[] = {
        {"call", CAP_CALL},
        {"import", CAP_IMPORT},
        {"inherit", CAP_INHERIT},
        {"member.container", CAP_MEMBER_CONTAINER},
        {"member.name", CAP_MEMBER_NAME},
        {"require.method", CAP_REQUIRE_METHOD},
        {"require.path", CAP_REQUIRE_PATH},
    };
    for (size_t i = 0; i < sizeof(kinds) / sizeof(kinds[0]); i++) {
        if (strlen(kinds[i].name) == len && strncmp(name, kinds[i].name, len) == 0) {
            return kinds[i].kind;
        }
    }
    return CAP_NONE;
}

/* Skip byte-identical repeats of one reference: same site kind, source
 * definition, and target name (a hub called many times in one function
 * becomes a single record; the first line wins). */
static cberg_status ref_seen(cberg_strmap *dedupe, uint8_t kind, uint8_t rev, int32_t src_def, const char *name, int *out_seen) {
    char key[CBERG_GRAPH_NAME_MAX + 32];
    snprintf(key, sizeof key, "%u:%u:%d:%s", kind, rev, src_def, name);
    uint64_t hit = 0;
    if (cberg_strmap_get(dedupe, key, &hit)) {
        *out_seen = 1;
        return CBERG_OK;
    }
    *out_seen = 0;
    return cberg_strmap_set(dedupe, key, 1);
}

static cberg_status add_named_ref(cberg_graph_fragment *frag, cberg_strmap *dedupe, uint8_t kind, uint8_t rev, int32_t src_def, const char *name, uint32_t line) {
    if (name == NULL || name[0] == '\0') {
        return CBERG_OK;
    }
    int seen = 0;
    cberg_status st = ref_seen(dedupe, kind, rev, src_def, name, &seen);
    if (st != CBERG_OK || seen) {
        return st;
    }
    return fragment_push_ref(frag, src_def, -1, name, line, kind, rev);
}

static cberg_status walk_matches(cberg_graph_fragment *frag, TSQuery *query, TSNode root, const char *src, size_t src_len) {
    TSQueryCursor *cursor = ts_query_cursor_new();
    if (cursor == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    cberg_strmap *dedupe = cberg_strmap_new(256);
    if (dedupe == NULL) {
        ts_query_cursor_delete(cursor);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = CBERG_OK;
    char text[CBERG_GRAPH_NAME_MAX];
    char container[CBERG_GRAPH_NAME_MAX];

    ts_query_cursor_exec(cursor, query, root);
    TSQueryMatch match;
    while (st == CBERG_OK && ts_query_cursor_next_match(cursor, &match)) {
        TSNode member_name_node = {0};
        int have_member_name = 0;
        container[0] = '\0';
        char require_method[CBERG_GRAPH_NAME_MAX];
        char require_path[CBERG_GRAPH_NAME_MAX];
        require_method[0] = '\0';
        require_path[0] = '\0';
        uint32_t require_line = 0;

        for (uint16_t i = 0; i < match.capture_count && st == CBERG_OK; i++) {
            TSQueryCapture cap = match.captures[i];
            uint32_t name_len = 0;
            const char *cap_name = ts_query_capture_name_for_id(query, cap.index, &name_len);
            uint32_t line = ts_node_start_point(cap.node).row + 1;

            switch (capture_kind(cap_name, name_len)) {
            case CAP_CALL:
                capture_text(src, src_len, cap.node, 0, text, sizeof text);
                /* Skip require/require_relative — handled as IMPORTS below. */
                if (strcmp(text, "require") == 0 || strcmp(text, "require_relative") == 0) {
                    break;
                }
                st = add_named_ref(frag, dedupe, CBERG_GEDGE_CALLS, 0, enclosing_def(frag, ts_node_start_byte(cap.node)), text, line);
                break;
            case CAP_IMPORT:
                capture_text(src, src_len, cap.node, 1, text, sizeof text);
                st = add_named_ref(frag, dedupe, CBERG_GEDGE_IMPORTS, 0, -1, text, line);
                break;
            case CAP_REQUIRE_METHOD:
                capture_text(src, src_len, cap.node, 0, require_method, sizeof require_method);
                require_line = line;
                break;
            case CAP_REQUIRE_PATH:
                capture_text(src, src_len, cap.node, 0, require_path, sizeof require_path);
                require_line = line;
                break;
            case CAP_INHERIT:
                capture_text(src, src_len, cap.node, 0, text, sizeof text);
                st = add_named_ref(frag, dedupe, CBERG_GEDGE_INHERITS, 0, enclosing_def(frag, ts_node_start_byte(cap.node)), text, line);
                break;
            case CAP_MEMBER_CONTAINER:
                capture_text(src, src_len, cap.node, 0, container, sizeof container);
                break;
            case CAP_MEMBER_NAME:
                member_name_node = cap.node;
                have_member_name = 1;
                break;
            default:
                break;
            }
        }

        /* Out-of-body membership: the enclosing def of the member's name is
         * the method itself; the edge (container -> method) resolves the
         * container by name at query time (it may live in another file). */
        if (st == CBERG_OK && have_member_name && container[0] != '\0') {
            int32_t method_def = enclosing_def(frag, ts_node_start_byte(member_name_node));
            if (method_def >= 0) {
                uint32_t line = ts_node_start_point(member_name_node).row + 1;
                st = add_named_ref(frag, dedupe, CBERG_GEDGE_CONTAINS, 1, method_def, container, line);
            }
        }

        /* Ruby require / require_relative "path" → IMPORTS (argument-aware). */
        if (st == CBERG_OK && require_path[0] != '\0' &&
            (strcmp(require_method, "require") == 0 || strcmp(require_method, "require_relative") == 0)) {
            st = add_named_ref(frag, dedupe, CBERG_GEDGE_IMPORTS, 0, -1, require_path,
                               require_line != 0 ? require_line : 1);
        }
    }

    cberg_strmap_free(dedupe);
    ts_query_cursor_delete(cursor);
    return st;
}

cberg_status cberg_graph_extract(cberg_graph_extractor *extractor, const TSLanguage *ts_lang, cberg_language lang, TSNode root, const char *path, const char *src, size_t src_len, const cberg_chunk_list *chunks, cberg_graph_fragment **out_fragment) {
    if (extractor == NULL || path == NULL || src == NULL || out_fragment == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_fragment = NULL;

    cberg_graph_fragment *frag = fragment_new(path, lang);
    if (frag == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = CBERG_OK;
    size_t n = cberg_chunk_list_len(chunks);
    for (size_t i = 0; i < n && st == CBERG_OK; i++) {
        const cberg_chunk *chunk = cberg_chunk_list_at(chunks, i);
        if (def_is_symbol(chunk->kind) && chunk->symbol != NULL) {
            st = fragment_push_def(frag, chunk);
        }
    }
    if (st == CBERG_OK) {
        st = fragment_add_nesting(frag);
    }

    TSQuery *query = NULL;
    if (st == CBERG_OK) {
        st = ensure_ref_query(extractor, ts_lang, lang, &query);
    }
    if (st == CBERG_OK && query != NULL) {
        st = walk_matches(frag, query, root, src, src_len);
    }

    if (st != CBERG_OK) {
        cberg_graph_fragment_free(frag);
        return st;
    }
    *out_fragment = frag;
    return CBERG_OK;
}
