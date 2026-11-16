/*
 * Tree-sitter chunker with per-language parser/query reuse. Markdown and
 * config formats are dispatched to their own parser-free chunkers.
 */
#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <tree_sitter/api.h>

#include "arena.h"
#include "chunk_keys.h"
#include "chunk_kind.h"
#include "chunker_internal.h"
#include "graph_internal.h"
#include "grow.h"

extern const TSLanguage *tree_sitter_go(void);
extern const TSLanguage *tree_sitter_c(void);
extern const TSLanguage *tree_sitter_java(void);
extern const TSLanguage *tree_sitter_javascript(void);
extern const TSLanguage *tree_sitter_python(void);
extern const TSLanguage *tree_sitter_kotlin(void);
extern const TSLanguage *tree_sitter_typescript(void);
extern const TSLanguage *tree_sitter_rust(void);
extern const TSLanguage *tree_sitter_ruby(void);

#define CBERG_LANG_SLOTS 10

_Static_assert((int)CBERG_LANG_RUBY + 1 == CBERG_LANG_SLOTS, "update CBERG_LANG_SLOTS when adding tree-sitter languages");
_Static_assert((int)CBERG_LANG_MARKDOWN == CBERG_LANG_SLOTS, "CBERG_LANG_MARKDOWN must stay outside parser slots");

typedef const TSLanguage *(*ts_language_fn)(void);

typedef struct {
    ts_language_fn language;
    const char *query;
} lang_desc;

static const char *const GO_QUERY =
    "(function_declaration name: (identifier) @name) @function\n"
    "(method_declaration name: (field_identifier) @name) @method\n"
    "(type_declaration (type_spec name: (type_identifier) @name type: (struct_type))) @struct\n"
    "(type_declaration (type_spec name: (type_identifier) @name type: (interface_type))) @interface\n";

static const char *const C_QUERY =
    "(function_definition declarator: (function_declarator declarator: (identifier) @name)) @function\n"
    "(function_definition declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))) @function\n"
    "(function_definition declarator: (pointer_declarator declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name)))) @function\n"
    "(function_definition declarator: (pointer_declarator declarator: (pointer_declarator declarator: (pointer_declarator declarator: (function_declarator declarator: (identifier) @name))))) @function\n"
    "(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @struct\n";

/* Module-level `const f = () => {}` style definitions; nested ones stay part of
 * their enclosing chunk so local callbacks do not explode the chunk count. */
#define JS_CONST_FUNCTION_VALUE "[(arrow_function) (function_expression) (generator_function)]"
#define JS_CONST_FUNCTION_DECL "(lexical_declaration (variable_declarator name: (identifier) @name value: " JS_CONST_FUNCTION_VALUE "))"
#define JS_CONST_FUNCTION_QUERY \
    "(program " JS_CONST_FUNCTION_DECL " @function)\n" \
    "(program (export_statement declaration: " JS_CONST_FUNCTION_DECL " @function))\n"

static const char *const JAVASCRIPT_QUERY =
    "(function_declaration name: (identifier) @name) @function\n"
    "(class_declaration name: (identifier) @name) @class\n"
    "(method_definition name: (property_identifier) @name) @method\n"
    JS_CONST_FUNCTION_QUERY;

static const char *const TYPESCRIPT_QUERY =
    "(function_declaration name: (identifier) @name) @function\n"
    "(class_declaration name: (type_identifier) @name) @class\n"
    "(interface_declaration name: (type_identifier) @name) @interface\n"
    "(method_definition name: (property_identifier) @name) @method\n"
    JS_CONST_FUNCTION_QUERY;

static const char *const PYTHON_QUERY =
    "(function_definition name: (identifier) @name) @function\n"
    "(class_definition name: (identifier) @name) @class\n";

static const char *const JAVA_QUERY =
    "(class_declaration name: (identifier) @name) @class\n"
    "(interface_declaration name: (identifier) @name) @interface\n"
    "(method_declaration name: (identifier) @name) @method\n"
    "(constructor_declaration name: (identifier) @name) @method\n";

static const char *const KOTLIN_QUERY =
    "(function_declaration (simple_identifier) @name) @function\n"
    "(class_declaration (type_identifier) @name) @class\n";

static const char *const RUST_QUERY =
    "(function_item name: (identifier) @name) @function\n"
    "(struct_item name: (type_identifier) @name) @struct\n"
    "(enum_item name: (type_identifier) @name) @struct\n"
    "(trait_item name: (type_identifier) @name) @interface\n";

static const char *const RUBY_QUERY =
    "(method name: (identifier) @name) @method\n"
    "(singleton_method name: (identifier) @name) @method\n"
    "(class name: (constant) @name) @class\n"
    "(module name: (constant) @name) @class\n";

static lang_desc descriptor_for(cberg_language lang) {
    switch (lang) {
    case CBERG_LANG_GO:
        return (lang_desc){tree_sitter_go, GO_QUERY};
    case CBERG_LANG_C:
        return (lang_desc){tree_sitter_c, C_QUERY};
    case CBERG_LANG_JAVASCRIPT:
        return (lang_desc){tree_sitter_javascript, JAVASCRIPT_QUERY};
    case CBERG_LANG_TYPESCRIPT:
        return (lang_desc){tree_sitter_typescript, TYPESCRIPT_QUERY};
    case CBERG_LANG_PYTHON:
        return (lang_desc){tree_sitter_python, PYTHON_QUERY};
    case CBERG_LANG_JAVA:
        return (lang_desc){tree_sitter_java, JAVA_QUERY};
    case CBERG_LANG_KOTLIN:
        return (lang_desc){tree_sitter_kotlin, KOTLIN_QUERY};
    case CBERG_LANG_RUST:
        return (lang_desc){tree_sitter_rust, RUST_QUERY};
    case CBERG_LANG_RUBY:
        return (lang_desc){tree_sitter_ruby, RUBY_QUERY};
    default:
        return (lang_desc){NULL, NULL};
    }
}

struct cberg_chunker {
    TSParser *parsers[CBERG_LANG_SLOTS];
    TSQuery *queries[CBERG_LANG_SLOTS];
    cberg_language query_lang[CBERG_LANG_SLOTS];
    cberg_graph_extractor *extractor; /* lazy; graph ref queries share the parse */
};

static int lang_slot(cberg_language lang) {
    if (lang <= CBERG_LANG_UNKNOWN || lang >= CBERG_LANG_SLOTS) {
        return -1;
    }
    return (int)lang;
}

static int compare_chunks(const void *a, const void *b) {
    const cberg_chunk *ca = a;
    const cberg_chunk *cb = b;
    if (ca->span.start_byte < cb->span.start_byte) {
        return -1;
    }
    if (ca->span.start_byte > cb->span.start_byte) {
        return 1;
    }
    return 0;
}

cberg_status cberg_chunker_open(cberg_chunker **out_chunker) {
    if (out_chunker == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_chunker *ch = calloc(1, sizeof(cberg_chunker));
    if (ch == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    for (int i = 0; i < CBERG_LANG_SLOTS; i++) {
        ch->query_lang[i] = CBERG_LANG_UNKNOWN;
    }
    *out_chunker = ch;
    return CBERG_OK;
}

static void free_lang_slot(cberg_chunker *ch, int slot) {
    if (ch->queries[slot] != NULL) {
        ts_query_delete(ch->queries[slot]);
        ch->queries[slot] = NULL;
    }
    if (ch->parsers[slot] != NULL) {
        ts_parser_delete(ch->parsers[slot]);
        ch->parsers[slot] = NULL;
    }
    ch->query_lang[slot] = CBERG_LANG_UNKNOWN;
}

void cberg_chunker_close(cberg_chunker *chunker) {
    if (chunker == NULL) {
        return;
    }
    for (int i = 0; i < CBERG_LANG_SLOTS; i++) {
        free_lang_slot(chunker, i);
    }
    cberg_graph_extractor_free(chunker->extractor);
    free(chunker);
}

static cberg_status ensure_lang(cberg_chunker *ch, cberg_language lang, lang_desc desc, int slot, TSParser **out_parser, TSQuery **out_query) {
    if (ch->parsers[slot] == NULL) {
        ch->parsers[slot] = ts_parser_new();
        if (ch->parsers[slot] == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        if (!ts_parser_set_language(ch->parsers[slot], desc.language())) {
            ts_parser_delete(ch->parsers[slot]);
            ch->parsers[slot] = NULL;
            return CBERG_ERR_INTERNAL;
        }
    }
    if (ch->queries[slot] == NULL || ch->query_lang[slot] != lang) {
        if (ch->queries[slot] != NULL) {
            ts_query_delete(ch->queries[slot]);
            ch->queries[slot] = NULL;
        }
        uint32_t err_offset = 0;
        TSQueryError err_type = TSQueryErrorNone;
        ch->queries[slot] = ts_query_new(desc.language(), desc.query, (uint32_t)strlen(desc.query), &err_offset, &err_type);
        if (ch->queries[slot] == NULL) {
            return CBERG_ERR_INTERNAL;
        }
        ch->query_lang[slot] = lang;
    }
    *out_parser = ch->parsers[slot];
    *out_query = ch->queries[slot];
    return CBERG_OK;
}

/* One file being chunked: its path and source text. */
typedef struct {
    const char *path;
    const char *src;
    size_t src_len;
} chunk_source;

/* The chunk one query match describes: the captured definition and, when the
 * pattern names it, its identifier node. */
typedef struct {
    cberg_chunk_kind kind;
    TSNode node;
    TSNode name;
    bool has_name;
} chunk_match;

/* Reads the chunk and name captures of one match. Returns false when the
 * match captures no chunk kind. */
static bool read_chunk_match(const TSQuery *query, const TSQueryMatch *match, chunk_match *out) {
    bool has_chunk = false;
    out->has_name = false;

    for (uint16_t i = 0; i < match->capture_count; i++) {
        TSQueryCapture cap = match->captures[i];
        uint32_t name_len = 0;
        const char *cap_name = ts_query_capture_name_for_id(query, cap.index, &name_len);
        cberg_chunk_kind kind = cberg_chunk_kind_from_capture(cap_name, name_len);

        if (kind != CBERG_CHUNK_UNKNOWN) {
            out->kind = kind;
            out->node = cap.node;
            has_chunk = true;
        } else if (name_len == 4 && strncmp(cap_name, "name", 4) == 0) {
            out->name = cap.node;
            out->has_name = true;
        }
    }

    return has_chunk;
}

/* Appends the chunk for one match. Generated code can carry absurd
 * identifiers; such a definition is skipped rather than failing the file. */
static cberg_status push_match_chunk(const chunk_source *file, const chunk_match *m, chunk_occ_tracker *occ, cberg_chunk_list *list) {
    char sym_buf[CBERG_CHUNK_IDENT_MAX];
    const char *symbol = NULL;
    uint32_t sym_start = 0;
    uint32_t sym_end = 0;

    if (m->has_name) {
        sym_start = ts_node_start_byte(m->name);
        sym_end = ts_node_end_byte(m->name);
        size_t sym_len = (size_t)(sym_end - sym_start);

        if (!chunk_ident_fits(file->path, m->kind, sym_len)) {
            return CBERG_OK;
        }

        memcpy(sym_buf, file->src + sym_start, sym_len);
        sym_buf[sym_len] = '\0';
        symbol = sym_buf;
    }

    uint32_t index = 0;
    cberg_status status = chunk_occ_next(occ, file->path, m->kind, symbol, &index);
    if (status != CBERG_OK) {
        return status;
    }

    cberg_span span = {
        .start_byte = ts_node_start_byte(m->node),
        .end_byte = ts_node_end_byte(m->node),
        .start_line = ts_node_start_point(m->node).row + 1,
        .end_line = ts_node_end_point(m->node).row + 1,
    };
    return chunk_list_push(list, file->path, m->kind, span, file->src, sym_start, sym_end, index);
}

/* Runs the chunk query over tree and appends every matched chunk to list,
 * sorted by position. */
static cberg_status collect_chunks(const TSQuery *query, TSTree *tree, const chunk_source *file, cberg_chunk_list *list) {
    TSQueryCursor *cursor = ts_query_cursor_new();
    chunk_occ_tracker *occ = chunk_occ_new();
    cberg_status status = cursor != NULL && occ != NULL ? CBERG_OK : CBERG_ERR_OUT_OF_MEMORY;

    if (status == CBERG_OK) {
        ts_query_cursor_exec(cursor, query, ts_tree_root_node(tree));
    }

    TSQueryMatch match;
    while (status == CBERG_OK && ts_query_cursor_next_match(cursor, &match)) {
        chunk_match m;
        if (read_chunk_match(query, &match, &m)) {
            status = push_match_chunk(file, &m, occ, list);
        }
    }

    if (status == CBERG_OK && list->len > 1) {
        qsort(list->items, list->len, sizeof(cberg_chunk), compare_chunks);
    }

    chunk_occ_free(occ);
    if (cursor != NULL) {
        ts_query_cursor_delete(cursor);
    }
    return status;
}

/* Graph extraction reuses the chunking parse tree (ADR 0005: one parse pass
 * feeds both indexes). The extractor is created on first use. */
static cberg_status extract_graph(cberg_chunker *ch, lang_desc desc, cberg_language lang, TSTree *tree, const chunk_source *file, const cberg_chunk_list *list, cberg_graph_fragment **out_frag) {
    if (ch->extractor == NULL) {
        ch->extractor = cberg_graph_extractor_new();
        if (ch->extractor == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }

    TSNode root = ts_tree_root_node(tree);
    return cberg_graph_extract(ch->extractor, desc.language(), lang, root, file->path, file->src, file->src_len, list, out_frag);
}

static cberg_status query_chunk(cberg_chunker *ch, lang_desc desc, cberg_language lang, const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list, cberg_graph_fragment **out_frag) {
    int slot = lang_slot(lang);
    if (slot < 0) {
        return CBERG_ERR_UNSUPPORTED_LANGUAGE;
    }

    TSParser *parser = NULL;
    TSQuery *query = NULL;
    cberg_status status = ensure_lang(ch, lang, desc, slot, &parser, &query);
    if (status != CBERG_OK) {
        return status;
    }

    TSTree *tree = ts_parser_parse_string(parser, NULL, src, (uint32_t)src_len);
    if (tree == NULL) {
        return CBERG_ERR_INTERNAL;
    }

    chunk_source file = {.path = path, .src = src, .src_len = src_len};
    cberg_chunk_list *list = chunk_list_new();
    status = list != NULL ? collect_chunks(query, tree, &file, list) : CBERG_ERR_OUT_OF_MEMORY;

    if (status == CBERG_OK && out_frag != NULL) {
        status = extract_graph(ch, desc, lang, tree, &file, list, out_frag);
    }

    if (status == CBERG_OK) {
        *out_list = list;
        list = NULL;
    }

    cberg_chunk_list_free(list);
    ts_tree_delete(tree);
    return status;
}

cberg_status cberg_chunker_parse(cberg_chunker *chunker, cberg_language lang, const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list) {
    return cberg_chunker_analyze(chunker, lang, path, src, src_len, out_list, NULL);
}

cberg_status cberg_chunker_analyze(cberg_chunker *chunker, cberg_language lang, const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list, cberg_graph_fragment **out_fragment) {
    if (out_list == NULL || chunker == NULL || path == NULL || src == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_list = NULL;
    if (out_fragment != NULL) {
        *out_fragment = NULL;
    }

    /* Markdown / config / unknown files carry no graph structure: chunk only. */
    if (lang == CBERG_LANG_MARKDOWN) {
        return chunk_markdown(path, src, src_len, out_list);
    }
    if (lang == CBERG_LANG_YAML || lang == CBERG_LANG_TOML || lang == CBERG_LANG_JSON) {
        return chunk_config(lang, path, src, src_len, out_list);
    }
    lang_desc desc = descriptor_for(lang);
    if (desc.language == NULL) {
        return chunk_windows(path, src, src_len, out_list);
    }
    return query_chunk(chunker, desc, lang, path, src, src_len, out_list, out_fragment);
}
