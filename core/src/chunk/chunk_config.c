/* Structural chunkers for config formats (YAML / TOML / JSON); no parser. */
#include "chunker_internal.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "chunk_keys.h"
#include "chunk_kind.h"

#define CBERG_CONFIG_MAX_KEYS 256

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
 * CBERG_CHUNK_MAX_SECTION_LINES lines under the same symbol (lock files can put
 * thousands of lines under one key). `sym` may be NULL (preamble).
 */
static cberg_status cfg_emit(cfg_ctx *ctx, const char *sym, size_t start, size_t end, uint32_t start_line) {
    size_t b = start;
    uint32_t bline = start_line;
    while (b < end) {
        size_t e = b;
        uint32_t nl = 0;
        while (e < end && nl < CBERG_CHUNK_MAX_SECTION_LINES) {
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
        st = chunk_list_push(ctx->list, ctx->path, CBERG_CHUNK_KEY, span, sym, 0, sym != NULL ? (uint32_t)strlen(sym) : 0, index);
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
/* Index of the first `:` that ends a mapping key (followed by space, tab,
 * or end of line), skipping quoted text and stopping at a comment; len when
 * there is none. */
static size_t yaml_key_colon(const char *line, size_t len) {
    char quote = 0;
    for (size_t i = 0; i < len; i++) {
        char c = line[i];
        if (quote != 0) {
            quote = c == quote ? 0 : quote;
        } else if (c == '"' || c == '\'') {
            quote = c;
        } else if (c == '#') {
            return len;
        } else if (c == ':' && (i + 1 == len || line[i + 1] == ' ' || line[i + 1] == '\t')) {
            return i;
        }
    }
    return len;
}

static int yaml_key_line(const char *line, size_t len, size_t *sym_start, size_t *sym_len) {
    if (len == 0 || line[0] == ' ' || line[0] == '\t' || line[0] == '#' || line[0] == '-') {
        return 0;
    }

    size_t colon = yaml_key_colon(line, len);
    if (colon == len || colon == 0) {
        return 0;
    }

    /* The key is the text before the colon, trimmed and unquoted. */
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

/* Returns the index just past one member value starting at i: at the
 * top-level ',' that ends it, at the root '}', or after its closing bracket. */
static size_t json_skip_value(const char *s, size_t len, size_t i, uint32_t *line) {
    int depth = 0;

    while (i < len) {
        char c = s[i];
        if (c == '"') {
            i = json_skip_string(s, len, i, line);
            continue;
        }
        if (c == '\n') {
            (*line)++;
        }

        if (c == '{' || c == '[') {
            depth++;
        } else if (c == '}' || c == ']') {
            if (depth == 0) {
                return i; /* root '}' closes the object */
            }
            depth--;
            if (depth == 0) {
                return i + 1;
            }
        } else if (c == ',' && depth == 0) {
            return i;
        }
        i++;
    }
    return i;
}

/* Moves end back over trailing whitespace, but not before start. */
static size_t json_trim_end(const char *s, size_t start, size_t end) {
    while (end > start && (s[end - 1] == ' ' || s[end - 1] == '\t' || s[end - 1] == '\n' || s[end - 1] == '\r')) {
        end--;
    }
    return end;
}

/* Finishes at the root object's end (or EOF): anything non-blank after the
 * closing '}' becomes one untitled chunk. */
static cberg_status json_close_object(cfg_ctx *ctx, size_t len, size_t i, uint32_t line) {
    const char *s = ctx->src;
    if (i < len && s[i] == '}') {
        i++;
    }

    i = json_skip_ws(s, len, i, &line, 0);
    if (i < len && !cfg_span_blank(s, i, len)) {
        return cfg_emit(ctx, NULL, i, len, line);
    }
    return CBERG_OK;
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
    uint32_t line = 1;
    size_t i = json_skip_ws(s, len, 0, &line, 0);
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
            return json_close_object(ctx, len, i, line);
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

        i = json_skip_ws(s, len, key_end, &line, 0);
        if (i >= len || s[i] != ':') {
            *out_handled = 0;
            return CBERG_OK;
        }

        i = json_skip_value(s, len, i + 1, &line);
        cberg_status st = cfg_emit(ctx, sym, key_byte, json_trim_end(s, key_byte, i), key_line);
        if (st != CBERG_OK) {
            return st;
        }
    }
}

cberg_status chunk_config(cberg_language lang, const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list) {
    cberg_chunk_list *list = chunk_list_new();
    if (list == NULL) {
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
    /* Past this many keys the file is a data table (vocabulary, lockfile,
     * fixture), not configuration; windows keep it searchable without one
     * embedding per entry. */
    int data_file = list->len > CBERG_CONFIG_MAX_KEYS;
    if ((lang == CBERG_LANG_JSON && !json_handled) || list->len == 0 || data_file) {
        cberg_chunk_list_free(list);
        return chunk_windows(path, src, src_len, out_list);
    }
    *out_list = list;
    return CBERG_OK;
}
