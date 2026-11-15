/* Heading-aware Markdown chunker; needs no parser. */
#include "chunker_internal.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "chunk_keys.h"
#include "chunk_kind.h"

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
    return chunk_list_push(list, path, CBERG_CHUNK_SECTION, span, sym, 0, sym != NULL ? (uint32_t)crumb_len : 0, index);
}

/*
 * Splits markdown into heading sections: each chunk runs from a heading line
 * to the line before the next heading (any level); the symbol is the
 * breadcrumb of enclosing headings ("Install > Prerequisites"). Content
 * before the first heading is an unnamed preamble section; '#' inside fenced
 * code blocks does not split; sections longer than CBERG_CHUNK_MAX_SECTION_LINES
 * continue as extra chunks under the same symbol.
 */
cberg_status chunk_markdown(const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list) {
    cberg_chunk_list *list = chunk_list_new();
    if (list == NULL) {
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
        if (sec_lines >= CBERG_CHUNK_MAX_SECTION_LINES) {
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
