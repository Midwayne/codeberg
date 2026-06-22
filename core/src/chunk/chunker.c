/*
 * Tree-sitter chunker with per-language parser/query reuse.
 */
#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <tree_sitter/api.h>

#include "arena.h"
#include "chunk_keys.h"
#include "grow.h"

extern const TSLanguage *tree_sitter_go(void);
extern const TSLanguage *tree_sitter_c(void);
extern const TSLanguage *tree_sitter_java(void);
extern const TSLanguage *tree_sitter_javascript(void);
extern const TSLanguage *tree_sitter_python(void);
extern const TSLanguage *tree_sitter_kotlin(void);
extern const TSLanguage *tree_sitter_typescript(void);

#define CBERG_WINDOW_LINES 50
#define CBERG_LANG_SLOTS 8

_Static_assert((int)CBERG_LANG_JAVA + 1 == CBERG_LANG_SLOTS, "update CBERG_LANG_SLOTS when adding languages");

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
    "(struct_specifier name: (type_identifier) @name body: (field_declaration_list)) @struct\n";

static const char *const JAVASCRIPT_QUERY =
    "(function_declaration name: (identifier) @name) @function\n"
    "(class_declaration name: (identifier) @name) @class\n"
    "(method_definition name: (property_identifier) @name) @method\n";

static const char *const TYPESCRIPT_QUERY =
    "(function_declaration name: (identifier) @name) @function\n"
    "(class_declaration name: (type_identifier) @name) @class\n"
    "(interface_declaration name: (type_identifier) @name) @interface\n"
    "(method_definition name: (property_identifier) @name) @method\n";

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
    default:
        return (lang_desc){NULL, NULL};
    }
}

struct cberg_chunk_list {
    cberg_arena *arena;
    cberg_chunk *items;
    size_t len;
    size_t cap;
};

struct cberg_chunker {
    TSParser *parsers[CBERG_LANG_SLOTS];
    TSQuery *queries[CBERG_LANG_SLOTS];
    cberg_language query_lang[CBERG_LANG_SLOTS];
};

static int lang_slot(cberg_language lang) {
    if (lang <= CBERG_LANG_UNKNOWN || lang >= CBERG_LANG_SLOTS) {
        return -1;
    }
    return (int)lang;
}

static cberg_chunk_kind kind_from_capture(const char *name, uint32_t len) {
    struct {
        const char *name;
        cberg_chunk_kind kind;
    } kinds[] = {
        {"function", CBERG_CHUNK_FUNCTION}, {"method", CBERG_CHUNK_METHOD},
        {"class", CBERG_CHUNK_CLASS},         {"struct", CBERG_CHUNK_STRUCT},
        {"interface", CBERG_CHUNK_INTERFACE},
    };
    for (size_t i = 0; i < sizeof(kinds) / sizeof(kinds[0]); i++) {
        if (strlen(kinds[i].name) == len && strncmp(name, kinds[i].name, len) == 0) {
            return kinds[i].kind;
        }
    }
    return CBERG_CHUNK_UNKNOWN;
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

static cberg_status list_reserve(cberg_chunk_list *list, size_t want) {
    size_t cap = cberg_grow_cap(list->cap, want, 16);
    if (cap == list->cap) {
        return CBERG_OK;
    }
    cberg_chunk *items = realloc(list->items, cap * sizeof(cberg_chunk));
    if (items == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    list->items = items;
    list->cap = cap;
    return CBERG_OK;
}

static cberg_status list_push(cberg_chunk_list *list, const char *path, cberg_chunk_kind kind, cberg_span span,
                              const char *symbol_src, uint32_t symbol_start, uint32_t symbol_end, uint32_t occ) {
    cberg_status st = list_reserve(list, list->len + 1);
    if (st != CBERG_OK) {
        return st;
    }
    char *path_copy = cberg_arena_strdup(list->arena, path);
    char *symbol = NULL;
    if (symbol_src != NULL && symbol_end > symbol_start) {
        symbol = cberg_arena_dup(list->arena, symbol_src + symbol_start, symbol_end - symbol_start);
    }
    char key_buf[CBERG_CHUNK_KEY_MAX];
    st = chunk_format_key(key_buf, sizeof(key_buf), path, kind, symbol, occ);
    if (st != CBERG_OK) {
        return st;
    }
    char *key = cberg_arena_strdup(list->arena, key_buf);
    if (st != CBERG_OK || path_copy == NULL || key == NULL) {
        return st != CBERG_OK ? st : CBERG_ERR_OUT_OF_MEMORY;
    }
    list->items[list->len++] = (cberg_chunk){
        .key = key,
        .path = path_copy,
        .symbol = symbol,
        .kind = kind,
        .span = span,
    };
    return CBERG_OK;
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
    free(chunker);
}

static cberg_status ensure_lang(cberg_chunker *ch, cberg_language lang, lang_desc desc, int slot, TSParser **out_parser,
                                TSQuery **out_query) {
    if (ch->parsers[slot] == NULL) {
        ch->parsers[slot] = ts_parser_new();
        if (ch->parsers[slot] == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        if (!ts_parser_set_language(ch->parsers[slot], desc.language())) {
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

static cberg_status window_chunk(const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list) {
    cberg_chunk_list *list = calloc(1, sizeof(cberg_chunk_list));
    if (list == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    list->arena = cberg_arena_new();
    if (list->arena == NULL) {
        free(list);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    uint32_t win_start_byte = 0;
    uint32_t win_start_line = 1;
    uint32_t line = 1;
    uint32_t lines_in_window = 0;
    uint32_t occ = 0;

    for (size_t i = 0; i < src_len; i++) {
        if (src[i] == '\n') {
            line++;
            lines_in_window++;
            if (lines_in_window >= CBERG_WINDOW_LINES) {
                cberg_span span = {
                    .start_byte = win_start_byte,
                    .end_byte = (uint32_t)(i + 1),
                    .start_line = win_start_line,
                    .end_line = line - 1,
                };
                cberg_status st = list_push(list, path, CBERG_CHUNK_WINDOW, span, NULL, 0, 0, occ++);
                if (st != CBERG_OK) {
                    cberg_chunk_list_free(list);
                    return st;
                }
                win_start_byte = (uint32_t)(i + 1);
                win_start_line = line;
                lines_in_window = 0;
            }
        }
    }
    if (win_start_byte < src_len) {
        cberg_span span = {
            .start_byte = win_start_byte,
            .end_byte = (uint32_t)src_len,
            .start_line = win_start_line,
            .end_line = line,
        };
        cberg_status st = list_push(list, path, CBERG_CHUNK_WINDOW, span, NULL, 0, 0, occ);
        if (st != CBERG_OK) {
            cberg_chunk_list_free(list);
            return st;
        }
    }
    *out_list = list;
    return CBERG_OK;
}

static cberg_status query_chunk(cberg_chunker *ch, lang_desc desc, cberg_language lang, const char *path,
                                const char *src, size_t src_len, cberg_chunk_list **out_list) {
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

    TSQueryCursor *cursor = ts_query_cursor_new();
    if (cursor == NULL) {
        ts_tree_delete(tree);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_chunk_list *list = calloc(1, sizeof(cberg_chunk_list));
    if (list == NULL) {
        ts_query_cursor_delete(cursor);
        ts_tree_delete(tree);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    list->arena = cberg_arena_new();
    if (list->arena == NULL) {
        free(list);
        ts_query_cursor_delete(cursor);
        ts_tree_delete(tree);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    ts_query_cursor_exec(cursor, query, ts_tree_root_node(tree));
    TSQueryMatch match;
    chunk_occ_tracker *occ = NULL;
    occ = chunk_occ_new();

    if (occ == NULL) {
        status = CBERG_ERR_OUT_OF_MEMORY;
        goto done;
    }

    while (ts_query_cursor_next_match(cursor, &match)) {
        cberg_chunk_kind kind = CBERG_CHUNK_UNKNOWN;
        TSNode chunk_node;
        bool have_chunk = false;
        TSNode name_node;
        bool have_name = false;

        for (uint16_t i = 0; i < match.capture_count; i++) {
            TSQueryCapture cap = match.captures[i];
            uint32_t name_len = 0;
            const char *cap_name = ts_query_capture_name_for_id(query, cap.index, &name_len);
            cberg_chunk_kind k = kind_from_capture(cap_name, name_len);
            if (k != CBERG_CHUNK_UNKNOWN) {
                kind = k;
                chunk_node = cap.node;
                have_chunk = true;
            } else if (name_len == 4 && strncmp(cap_name, "name", 4) == 0) {
                name_node = cap.node;
                have_name = true;
            }
        }
        if (!have_chunk) {
            continue;
        }

        char sym_buf[CBERG_CHUNK_IDENT_MAX];
        const char *sym_for_occ = NULL;
        uint32_t sym_start = 0;
        uint32_t sym_end = 0;
        if (have_name) {
            sym_start = ts_node_start_byte(name_node);
            sym_end = ts_node_end_byte(name_node);
            size_t sym_len = (size_t)(sym_end - sym_start);
            if (sym_len >= sizeof(sym_buf)) {
                status = CBERG_ERR_INVALID_ARGUMENT;
                goto done;
            }
            memcpy(sym_buf, src + sym_start, sym_len);
            sym_buf[sym_len] = '\0';
            sym_for_occ = sym_buf;
        }
        uint32_t index = 0;
        status = chunk_occ_next(occ, path, kind, sym_for_occ, &index);
        if (status != CBERG_OK) {
            goto done;
        }

        cberg_span span = {
            .start_byte = ts_node_start_byte(chunk_node),
            .end_byte = ts_node_end_byte(chunk_node),
            .start_line = ts_node_start_point(chunk_node).row + 1,
            .end_line = ts_node_end_point(chunk_node).row + 1,
        };
        status = list_push(list, path, kind, span, src, sym_start, sym_end, index);
        if (status != CBERG_OK) {
            goto done;
        }
    }

    if (list->len > 1) {
        qsort(list->items, list->len, sizeof(cberg_chunk), compare_chunks);
    }
    *out_list = list;
    list = NULL;
    status = CBERG_OK;

done:
    chunk_occ_free(occ);
    cberg_chunk_list_free(list);
    ts_query_cursor_delete(cursor);
    ts_tree_delete(tree);
    return status;
}

cberg_status cberg_chunker_parse(cberg_chunker *chunker, cberg_language lang, const char *path, const char *src,
                               size_t src_len, cberg_chunk_list **out_list) {
    if (out_list == NULL || chunker == NULL || path == NULL || src == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_list = NULL;

    lang_desc desc = descriptor_for(lang);
    if (desc.language == NULL) {
        return window_chunk(path, src, src_len, out_list);
    }
    return query_chunk(chunker, desc, lang, path, src, src_len, out_list);
}

size_t cberg_chunk_list_len(const cberg_chunk_list *list) {
    return list == NULL ? 0 : list->len;
}

const cberg_chunk *cberg_chunk_list_at(const cberg_chunk_list *list, size_t index) {
    if (list == NULL || index >= list->len) {
        return NULL;
    }
    return &list->items[index];
}

void cberg_chunk_list_free(cberg_chunk_list *list) {
    if (list == NULL) {
        return;
    }
    cberg_arena_free(list->arena);
    free(list->items);
    free(list);
}

cberg_status cberg_chunk_list_hash_bodies(const cberg_chunk_list *list, const char *src, size_t src_len) {
    if (list == NULL || src == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    for (size_t i = 0; i < list->len; i++) {
        cberg_chunk *c = &list->items[i];
        if (c->span.end_byte > src_len || c->span.start_byte > c->span.end_byte) {
            return CBERG_ERR_INVALID_ARGUMENT;
        }
        cberg_status st =
            cberg_hash(src + c->span.start_byte, c->span.end_byte - c->span.start_byte, c->content_hash);
        if (st != CBERG_OK) {
            return st;
        }
    }
    return CBERG_OK;
}
