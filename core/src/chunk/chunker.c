/*
 * Tree-sitter chunker with per-language parser/query reuse, plus a
 * heading-aware markdown chunker and structural chunkers for config
 * formats (YAML / TOML / JSON) that need no parser.
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
extern const TSLanguage *tree_sitter_rust(void);
extern const TSLanguage *tree_sitter_ruby(void);

#define CBERG_WINDOW_LINES 50
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
        {"function", CBERG_CHUNK_FUNCTION},
        {"method", CBERG_CHUNK_METHOD},
        {"class", CBERG_CHUNK_CLASS},
        {"struct", CBERG_CHUNK_STRUCT},
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

static cberg_status list_push(cberg_chunk_list *list, const char *path, cberg_chunk_kind kind, cberg_span span, const char *symbol_src, uint32_t symbol_start, uint32_t symbol_end, uint32_t occ) {
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
    if (path_copy == NULL || key == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
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

static cberg_status ensure_lang(cberg_chunker *ch, cberg_language lang, lang_desc desc, int slot, TSParser **out_parser, TSQuery **out_query) {
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

/* --- Markdown ------------------------------------------------------------ */

#define CBERG_MD_SECTION_MAX_LINES 200
#define CBERG_MD_MAX_DEPTH 6
#define CBERG_MD_TITLE_MAX 120

typedef struct {
    int level;
    char title[CBERG_MD_TITLE_MAX];
} md_heading;

/*
 * ATX heading (CommonMark): up to 3 leading spaces, 1-6 '#' followed by
 * space/tab or end of line. Returns the level and the title span with the
 * optional closing '#' run trimmed; 0 when the line is not a heading.
 */
static int md_heading_level(const char *line, size_t len, size_t *out_start, size_t *out_len) {
    size_t i = 0;
    while (i < len && i < 3 && line[i] == ' ') {
        i++;
    }
    size_t hashes = 0;
    while (i + hashes < len && line[i + hashes] == '#') {
        hashes++;
    }
    if (hashes == 0 || hashes > 6) {
        return 0;
    }
    size_t t = i + hashes;
    if (t < len && line[t] != ' ' && line[t] != '\t') {
        return 0;
    }
    while (t < len && (line[t] == ' ' || line[t] == '\t')) {
        t++;
    }
    size_t end = len;
    while (end > t && (line[end - 1] == ' ' || line[end - 1] == '\t')) {
        end--;
    }
    /* A closing '#' run counts only when the whole text is hashes or a space
     * precedes it — "# About C#" keeps its '#'. */
    size_t close = end;
    while (close > t && line[close - 1] == '#') {
        close--;
    }
    if (close < end && (close == t || line[close - 1] == ' ' || line[close - 1] == '\t')) {
        end = close;
        while (end > t && (line[end - 1] == ' ' || line[end - 1] == '\t')) {
            end--;
        }
    }
    *out_start = t;
    *out_len = end - t;
    return (int)hashes;
}

/* Length of a ``` / ~~~ fence run (>= 3, up to 3 leading spaces), else 0. */
static size_t md_fence_run(const char *line, size_t len, char *out_ch, size_t *out_start) {
    size_t i = 0;
    while (i < len && i < 3 && line[i] == ' ') {
        i++;
    }
    if (i >= len || (line[i] != '`' && line[i] != '~')) {
        return 0;
    }
    char c = line[i];
    size_t run = 0;
    while (i + run < len && line[i + run] == c) {
        run++;
    }
    if (run < 3) {
        return 0;
    }
    if (out_start != NULL) {
        *out_start = i;
    }
    *out_ch = c;
    return run;
}

static int md_fence_close(const char *line, size_t len, char fence_ch, size_t fence_len) {
    char c = 0;
    size_t fence_start = 0;
    size_t run = md_fence_run(line, len, &c, &fence_start);
    if (run < fence_len || c != fence_ch) {
        return 0;
    }
    for (size_t j = fence_start + run; j < len; j++) {
        if (line[j] != ' ' && line[j] != '\t') {
            return 0;
        }
    }
    return 1;
}

static size_t md_build_crumb(const md_heading *stack, int depth, char *out, size_t cap) {
    out[0] = '\0';
    size_t used = 0;
    for (int i = 0; i < depth; i++) {
        int n = snprintf(out + used, cap - used, "%s%s", i > 0 ? " > " : "", stack[i].title);
        if (n < 0 || (size_t)n >= cap - used) {
            return used;
        }
        used += (size_t)n;
    }
    return used;
}

static cberg_status md_emit(cberg_chunk_list *list, chunk_occ_tracker *occ, const char *path, const char *crumb, size_t crumb_len, uint32_t start_byte, uint32_t end_byte, uint32_t start_line, uint32_t end_line) {
    const char *sym = (crumb != NULL && crumb_len > 0) ? crumb : NULL;
    uint32_t index = 0;
    cberg_status st = chunk_occ_next(occ, path, CBERG_CHUNK_SECTION, sym, &index);
    if (st != CBERG_OK) {
        return st;
    }
    cberg_span span = {
        .start_byte = start_byte,
        .end_byte = end_byte,
        .start_line = start_line,
        .end_line = end_line,
    };
    return list_push(list, path, CBERG_CHUNK_SECTION, span, sym, 0, sym != NULL ? (uint32_t)crumb_len : 0, index);
}

/*
 * Splits markdown into heading sections: each chunk runs from a heading line
 * to the line before the next heading (any level); the symbol is the
 * breadcrumb of enclosing headings ("Install > Prerequisites"). Content
 * before the first heading is an unnamed preamble section; '#' inside fenced
 * code blocks does not split; sections longer than CBERG_MD_SECTION_MAX_LINES
 * continue as extra chunks under the same symbol.
 */
static cberg_status markdown_chunk(const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list) {
    cberg_chunk_list *list = calloc(1, sizeof(cberg_chunk_list));
    if (list == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    list->arena = cberg_arena_new();
    if (list->arena == NULL) {
        free(list);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    chunk_occ_tracker *occ = chunk_occ_new();
    if (occ == NULL) {
        cberg_chunk_list_free(list);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    md_heading stack[CBERG_MD_MAX_DEPTH];
    int depth = 0;
    char crumb[CBERG_CHUNK_IDENT_MAX];
    size_t crumb_len = 0;

    int sec_has_content = 0;
    uint32_t sec_start_byte = 0;
    uint32_t sec_start_line = 1;
    uint32_t sec_lines = 0;
    uint32_t line_no = 0;
    int in_fence = 0;
    char fence_ch = 0;
    size_t fence_len = 0;
    cberg_status st = CBERG_OK;

    size_t pos = 0;
    while (pos < src_len) {
        line_no++;
        size_t line_start = pos;
        const char *nl_ptr = memchr(src + pos, '\n', src_len - pos);
        size_t nl = nl_ptr != NULL ? (size_t)(nl_ptr - src) : src_len;
        size_t parse_len = nl - line_start;
        if (parse_len > 0 && src[line_start + parse_len - 1] == '\r') {
            parse_len--;
        }
        const char *line = src + line_start;

        int heading = 0;
        size_t title_start = 0;
        size_t title_len = 0;
        if (in_fence) {
            if (md_fence_close(line, parse_len, fence_ch, fence_len)) {
                in_fence = 0;
            }
        } else {
            size_t run = md_fence_run(line, parse_len, &fence_ch, NULL);
            if (run > 0) {
                in_fence = 1;
                fence_len = run;
            } else {
                heading = md_heading_level(line, parse_len, &title_start, &title_len);
            }
        }

        if (heading > 0) {
            if (depth > 0) {
                st = md_emit(list, occ, path, crumb, crumb_len, sec_start_byte, (uint32_t)line_start, sec_start_line, line_no - 1);
            } else if (sec_has_content) {
                st = md_emit(list, occ, path, NULL, 0, sec_start_byte, (uint32_t)line_start, sec_start_line, line_no - 1);
            }
            if (st != CBERG_OK) {
                goto fail;
            }
            while (depth > 0 && stack[depth - 1].level >= heading) {
                depth--;
            }
            md_heading *h = &stack[depth++];
            h->level = heading;
            size_t copy = title_len < CBERG_MD_TITLE_MAX - 1 ? title_len : CBERG_MD_TITLE_MAX - 1;
            memcpy(h->title, line + title_start, copy);
            h->title[copy] = '\0';
            crumb_len = md_build_crumb(stack, depth, crumb, sizeof(crumb));

            sec_has_content = 0;
            sec_start_byte = (uint32_t)line_start;
            sec_start_line = line_no;
            sec_lines = 0;
        }

        for (size_t bi = line_start; bi < line_start + parse_len; bi++) {
            char c = src[bi];
            if (c != ' ' && c != '\t' && c != '\r') {
                sec_has_content = 1;
                break;
            }
        }

        sec_lines++;
        size_t line_end = nl < src_len ? nl + 1 : src_len;
        if (sec_lines >= CBERG_MD_SECTION_MAX_LINES) {
            st = md_emit(list, occ, path, depth > 0 ? crumb : NULL, depth > 0 ? crumb_len : 0, sec_start_byte, (uint32_t)line_end, sec_start_line, line_no);
            if (st != CBERG_OK) {
                goto fail;
            }
            sec_start_byte = (uint32_t)line_end;
            sec_start_line = line_no + 1;
            sec_lines = 0;
        }
        pos = line_end;
    }

    if (sec_start_byte < src_len) {
        if (depth > 0) {
            st = md_emit(list, occ, path, crumb, crumb_len, sec_start_byte, (uint32_t)src_len, sec_start_line, line_no);
        } else if (sec_has_content) {
            st = md_emit(list, occ, path, NULL, 0, sec_start_byte, (uint32_t)src_len, sec_start_line, line_no);
        }
        if (st != CBERG_OK) {
            goto fail;
        }
    }

    chunk_occ_free(occ);
    *out_list = list;
    return CBERG_OK;

fail:
    chunk_occ_free(occ);
    cberg_chunk_list_free(list);
    return st;
}

/* --- Config files (YAML / TOML / JSON) ----------------------------------- */

#define CBERG_CFG_CHUNK_MAX_LINES 200

typedef struct {
    cberg_chunk_list *list;
    chunk_occ_tracker *occ;
    const char *path;
    const char *src;
} cfg_ctx;

static int cfg_span_blank(const char *src, size_t start, size_t end) {
    for (size_t i = start; i < end; i++) {
        char c = src[i];
        if (c != ' ' && c != '\t' && c != '\n' && c != '\r') {
            return 0;
        }
    }
    return 1;
}

/*
 * Emits [start, end) as CBERG_CHUNK_KEY chunks, continuing every
 * CBERG_CFG_CHUNK_MAX_LINES lines under the same symbol (lock files can put
 * thousands of lines under one key). `sym` may be NULL (preamble).
 */
static cberg_status cfg_emit(cfg_ctx *ctx, const char *sym, size_t start, size_t end, uint32_t start_line) {
    size_t b = start;
    uint32_t bline = start_line;
    while (b < end) {
        size_t e = b;
        uint32_t nl = 0;
        while (e < end && nl < CBERG_CFG_CHUNK_MAX_LINES) {
            if (ctx->src[e] == '\n') {
                nl++;
            }
            e++;
        }
        uint32_t eline;
        if (nl == 0) {
            eline = bline;
        } else if (ctx->src[e - 1] == '\n') {
            eline = bline + nl - 1;
        } else {
            eline = bline + nl;
        }
        uint32_t index = 0;
        cberg_status st = chunk_occ_next(ctx->occ, ctx->path, CBERG_CHUNK_KEY, sym, &index);
        if (st != CBERG_OK) {
            return st;
        }
        cberg_span span = {
            .start_byte = (uint32_t)b,
            .end_byte = (uint32_t)e,
            .start_line = bline,
            .end_line = eline,
        };
        st = list_push(ctx->list, ctx->path, CBERG_CHUNK_KEY, span, sym, 0, sym != NULL ? (uint32_t)strlen(sym) : 0, index);
        if (st != CBERG_OK) {
            return st;
        }
        b = e;
        bline = eline + 1;
    }
    return CBERG_OK;
}

/*
 * YAML boundary: a column-0 `key:` mapping line (colon followed by
 * space/tab or end of line, quotes respected, comments ignored). Indented
 * lines, list items, comments, and `---` separators are never boundaries,
 * so nested content stays inside its top-level key's chunk.
 */
static int yaml_key_line(const char *line, size_t len, size_t *sym_start, size_t *sym_len) {
    if (len == 0) {
        return 0;
    }
    char c0 = line[0];
    if (c0 == ' ' || c0 == '\t' || c0 == '#' || c0 == '-') {
        return 0;
    }
    size_t colon = len;
    int in_q = 0;
    char q = 0;
    for (size_t i = 0; i < len; i++) {
        char c = line[i];
        if (in_q) {
            if (c == q) {
                in_q = 0;
            }
            continue;
        }
        if (c == '"' || c == '\'') {
            in_q = 1;
            q = c;
            continue;
        }
        if (c == '#') {
            break;
        }
        if (c == ':' && (i + 1 == len || line[i + 1] == ' ' || line[i + 1] == '\t')) {
            colon = i;
            break;
        }
    }
    if (colon == len || colon == 0) {
        return 0;
    }
    size_t s = 0;
    size_t e = colon;
    while (e > s && (line[e - 1] == ' ' || line[e - 1] == '\t')) {
        e--;
    }
    if (e - s >= 2 && ((line[s] == '"' && line[e - 1] == '"') || (line[s] == '\'' && line[e - 1] == '\''))) {
        s++;
        e--;
    }
    if (e <= s) {
        return 0;
    }
    *sym_start = s;
    *sym_len = e - s;
    return 1;
}

/* TOML boundary: a `[table]` / `[[array-of-tables]]` header line. */
static int toml_table_line(const char *line, size_t len, size_t *sym_start, size_t *sym_len) {
    size_t i = 0;
    while (i < len && (line[i] == ' ' || line[i] == '\t')) {
        i++;
    }
    if (i >= len || line[i] != '[') {
        return 0;
    }
    size_t s = i + 1;
    if (s < len && line[s] == '[') {
        s++;
    }
    size_t e = s;
    while (e < len && line[e] != ']') {
        e++;
    }
    if (e >= len) {
        return 0;
    }
    while (s < e && (line[s] == ' ' || line[s] == '\t')) {
        s++;
    }
    size_t b = e;
    while (b > s && (line[b - 1] == ' ' || line[b - 1] == '\t')) {
        b--;
    }
    if (b <= s) {
        return 0;
    }
    *sym_start = s;
    *sym_len = b - s;
    return 1;
}

static void cfg_copy_sym(char *dst, const char *src, size_t off, size_t len) {
    size_t copy = len < CBERG_CHUNK_IDENT_MAX - 1 ? len : CBERG_CHUNK_IDENT_MAX - 1;
    memcpy(dst, src + off, copy);
    dst[copy] = '\0';
}

static cberg_status cfg_flush_section(cfg_ctx *ctx, int have_sym, const char *sym, size_t start, size_t end, uint32_t start_line) {
    if (have_sym) {
        return cfg_emit(ctx, sym, start, end, start_line);
    }
    if (!cfg_span_blank(ctx->src, start, end)) {
        return cfg_emit(ctx, NULL, start, end, start_line);
    }
    return CBERG_OK;
}

typedef int (*cfg_boundary_fn)(const char *line, size_t len, size_t *sym_start, size_t *sym_len);

/*
 * Line-oriented chunking for YAML and TOML: each boundary line starts a chunk
 * named after it; content before the first boundary is an unnamed preamble.
 */
static cberg_status cfg_line_chunks(cfg_ctx *ctx, size_t src_len, cfg_boundary_fn boundary) {
    const char *src = ctx->src;
    char sym[CBERG_CHUNK_IDENT_MAX];
    int have = 0;
    size_t sec_start = 0;
    uint32_t sec_line = 1;
    uint32_t line_no = 0;
    cberg_status st = CBERG_OK;

    size_t pos = 0;
    while (pos < src_len) {
        line_no++;
        size_t line_start = pos;
        size_t nl = pos;
        while (nl < src_len && src[nl] != '\n') {
            nl++;
        }
        size_t parse_len = nl - line_start;
        if (parse_len > 0 && src[line_start + parse_len - 1] == '\r') {
            parse_len--;
        }

        size_t ss = 0;
        size_t sl = 0;
        if (boundary(src + line_start, parse_len, &ss, &sl)) {
            st = cfg_flush_section(ctx, have, sym, sec_start, line_start, sec_line);
            if (st != CBERG_OK) {
                return st;
            }
            cfg_copy_sym(sym, src, line_start + ss, sl);
            have = 1;
            sec_start = line_start;
            sec_line = line_no;
        }
        pos = nl < src_len ? nl + 1 : src_len;
    }

    if (sec_start < src_len) {
        return cfg_flush_section(ctx, have, sym, sec_start, src_len, sec_line);
    }
    return CBERG_OK;
}

/* Returns the index just past the closing quote, counting newlines. */
static size_t json_skip_string(const char *s, size_t len, size_t i, uint32_t *line) {
    i++;
    while (i < len) {
        char c = s[i];
        if (c == '\\') {
            if (i + 1 < len) {
                i += 2;
            } else {
                i = len;
            }
            continue;
        }
        if (c == '\n') {
            (*line)++;
        }
        if (c == '"') {
            return i + 1;
        }
        i++;
    }
    return len;
}

/* Skips whitespace, optional commas, and JSONC line/block comments. */
static size_t json_skip_ws(const char *s, size_t len, size_t i, uint32_t *line, int skip_comma) {
    for (;;) {
        while (i < len && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r' || (skip_comma && s[i] == ','))) {
            if (s[i] == '\n') {
                (*line)++;
            }
            i++;
        }
        if (i + 1 < len && s[i] == '/' && s[i + 1] == '/') {
            i += 2;
            while (i < len && s[i] != '\n') {
                i++;
            }
            continue;
        }
        if (i + 1 < len && s[i] == '/' && s[i + 1] == '*') {
            i += 2;
            while (i + 1 < len && !(s[i] == '*' && s[i + 1] == '/')) {
                if (s[i] == '\n') {
                    (*line)++;
                }
                i++;
            }
            if (i + 1 < len) {
                i += 2;
            } else {
                i = len;
            }
            continue;
        }
        break;
    }
    return i;
}

/*
 * Chunks a root JSON object into one chunk per top-level key (span = key
 * through its value, bracket- and string-aware). Sets *out_handled = 0 when
 * the root is not an object or parsing fails so the caller can fall back to
 * window chunks. JSONC comments are skipped; trailing non-whitespace after the
 * root object is emitted as one unnamed chunk.
 */
static cberg_status json_object_chunks(cfg_ctx *ctx, size_t len, int *out_handled) {
    const char *s = ctx->src;
    size_t i = 0;
    uint32_t line = 1;
    i = json_skip_ws(s, len, i, &line, 0);
    if (i >= len || s[i] != '{') {
        *out_handled = 0;
        return CBERG_OK;
    }
    *out_handled = 1;
    i++;

    char sym[CBERG_CHUNK_IDENT_MAX];
    for (;;) {
        i = json_skip_ws(s, len, i, &line, 1);
        if (i >= len || s[i] == '}') {
            if (i < len && s[i] == '}') {
                i++;
            }
            i = json_skip_ws(s, len, i, &line, 0);
            if (i < len && !cfg_span_blank(s, i, len)) {
                return cfg_emit(ctx, NULL, i, len, line);
            }
            return CBERG_OK;
        }
        if (s[i] != '"') {
            *out_handled = 0;
            return CBERG_OK;
        }

        size_t key_byte = i;
        uint32_t key_line = line;
        size_t txt_start = i + 1;
        size_t key_end = json_skip_string(s, len, i, &line);
        size_t txt_len = key_end > txt_start ? key_end - 1 - txt_start : 0;
        cfg_copy_sym(sym, s, txt_start, txt_len);
        i = key_end;

        i = json_skip_ws(s, len, i, &line, 0);
        if (i >= len || s[i] != ':') {
            *out_handled = 0;
            return CBERG_OK;
        }
        i++;

        int depth = 0;
        while (i < len) {
            char c = s[i];
            if (c == '"') {
                i = json_skip_string(s, len, i, &line);
                continue;
            }
            if (c == '\n') {
                line++;
            }
            if (c == '{' || c == '[') {
                depth++;
            } else if (c == '}' || c == ']') {
                if (depth == 0) {
                    break; /* root '}' closes the object */
                }
                depth--;
                if (depth == 0) {
                    i++;
                    break;
                }
            } else if (c == ',' && depth == 0) {
                break;
            }
            i++;
        }

        size_t vend = i;
        while (vend > key_byte && (s[vend - 1] == ' ' || s[vend - 1] == '\t' || s[vend - 1] == '\n' || s[vend - 1] == '\r')) {
            vend--;
        }
        cberg_status st = cfg_emit(ctx, sym, key_byte, vend, key_line);
        if (st != CBERG_OK) {
            return st;
        }
    }
}

static cberg_status config_chunk(cberg_language lang, const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list) {
    cberg_chunk_list *list = calloc(1, sizeof(cberg_chunk_list));
    if (list == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    list->arena = cberg_arena_new();
    if (list->arena == NULL) {
        free(list);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    chunk_occ_tracker *occ = chunk_occ_new();
    if (occ == NULL) {
        cberg_chunk_list_free(list);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cfg_ctx ctx = {.list = list, .occ = occ, .path = path, .src = src};
    cberg_status st;
    int json_handled = 1;
    if (lang == CBERG_LANG_JSON) {
        st = json_object_chunks(&ctx, src_len, &json_handled);
    } else {
        st = cfg_line_chunks(&ctx, src_len, lang == CBERG_LANG_TOML ? toml_table_line : yaml_key_line);
    }

    chunk_occ_free(occ);
    if (st != CBERG_OK) {
        cberg_chunk_list_free(list);
        return st;
    }
    if ((lang == CBERG_LANG_JSON && !json_handled) || list->len == 0) {
        cberg_chunk_list_free(list);
        return window_chunk(path, src, src_len, out_list);
    }
    *out_list = list;
    return CBERG_OK;
}

static cberg_status query_chunk(cberg_chunker *ch, lang_desc desc, cberg_language lang, const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list) {
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

cberg_status cberg_chunker_parse(cberg_chunker *chunker, cberg_language lang, const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list) {
    if (out_list == NULL || chunker == NULL || path == NULL || src == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_list = NULL;

    if (lang == CBERG_LANG_MARKDOWN) {
        return markdown_chunk(path, src, src_len, out_list);
    }
    if (lang == CBERG_LANG_YAML || lang == CBERG_LANG_TOML || lang == CBERG_LANG_JSON) {
        return config_chunk(lang, path, src, src_len, out_list);
    }
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
