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
/* Running state while scanning a Markdown file line by line. */
typedef struct {
    cberg_chunk_list *list;
    chunk_occ_tracker *occ;
    const char *path;

    /* Enclosing headings and their "A > B > C" breadcrumb. */
    md_heading stack[CBERG_MD_MAX_DEPTH];
    int depth;
    char crumb[CBERG_CHUNK_IDENT_MAX];
    size_t crumb_len;

    /* The open section. */
    int has_content;
    uint32_t start_byte;
    uint32_t start_line;
    uint32_t lines;

    /* An open fenced code block, where '#' lines are not headings. */
    int in_fence;
    char fence_ch;
    size_t fence_len;
} md_state;

/* Tracks code fences and returns the line's heading level (0 for none). */
static int md_line_heading(md_state *s, const char *line, size_t len, size_t *title_start, size_t *title_len) {
    if (s->in_fence) {
        if (md_fence_close(line, len, s->fence_ch, s->fence_len)) {
            s->in_fence = 0;
        }
        return 0;
    }

    size_t run = md_fence_run(line, len, &s->fence_ch, NULL);
    if (run > 0) {
        s->in_fence = 1;
        s->fence_len = run;
        return 0;
    }

    return md_heading_level(line, len, title_start, title_len);
}

static int md_line_has_content(const char *line, size_t len) {
    for (size_t i = 0; i < len; i++) {
        if (line[i] != ' ' && line[i] != '\t' && line[i] != '\r') {
            return 1;
        }
    }
    return 0;
}

/* Emits the open section, titled by the breadcrumb when under a heading. */
static cberg_status md_emit_section(md_state *s, uint32_t end_byte, uint32_t end_line) {
    const char *crumb = s->depth > 0 ? s->crumb : NULL;
    size_t crumb_len = s->depth > 0 ? s->crumb_len : 0;
    return md_emit(s->list, s->occ, s->path, crumb, crumb_len, s->start_byte, end_byte, s->start_line, end_line);
}

/* Emits the open section unless it is untitled and blank. */
static cberg_status md_close_section(md_state *s, uint32_t end_byte, uint32_t end_line) {
    if (s->depth == 0 && !s->has_content) {
        return CBERG_OK;
    }
    return md_emit_section(s, end_byte, end_line);
}

/* Replaces headings at this level or deeper with the new one. */
static void md_push_heading(md_state *s, int level, const char *title, size_t title_len) {
    while (s->depth > 0 && s->stack[s->depth - 1].level >= level) {
        s->depth--;
    }

    md_heading *h = &s->stack[s->depth++];
    h->level = level;

    size_t copy = title_len < CBERG_MD_TITLE_MAX - 1 ? title_len : CBERG_MD_TITLE_MAX - 1;
    memcpy(h->title, title, copy);
    h->title[copy] = '\0';

    s->crumb_len = md_build_crumb(s->stack, s->depth, s->crumb, sizeof(s->crumb));
}

/* Processes one line (len excludes the newline and a trailing CR). */
static cberg_status md_scan_line(md_state *s, const char *line, size_t len, uint32_t line_start, uint32_t line_end, uint32_t line_no) {
    size_t title_start = 0;
    size_t title_len = 0;
    int heading = md_line_heading(s, line, len, &title_start, &title_len);

    if (heading > 0) {
        cberg_status st = md_close_section(s, line_start, line_no - 1);
        if (st != CBERG_OK) {
            return st;
        }

        md_push_heading(s, heading, line + title_start, title_len);
        s->has_content = 0;
        s->start_byte = line_start;
        s->start_line = line_no;
        s->lines = 0;
    }

    if (md_line_has_content(line, len)) {
        s->has_content = 1;
    }

    /* Split an overly long section so no chunk grows without bound. */
    s->lines++;
    if (s->lines < CBERG_CHUNK_MAX_SECTION_LINES) {
        return CBERG_OK;
    }

    cberg_status st = md_emit_section(s, line_end, line_no);
    s->start_byte = line_end;
    s->start_line = line_no + 1;
    s->lines = 0;
    return st;
}

cberg_status chunk_markdown(const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list) {
    md_state s = {.path = path, .start_line = 1};
    s.list = chunk_list_new();
    s.occ = chunk_occ_new();
    cberg_status st = s.list != NULL && s.occ != NULL ? CBERG_OK : CBERG_ERR_OUT_OF_MEMORY;

    uint32_t line_no = 0;
    size_t pos = 0;
    while (st == CBERG_OK && pos < src_len) {
        line_no++;

        const char *nl_ptr = memchr(src + pos, '\n', src_len - pos);
        size_t nl = nl_ptr != NULL ? (size_t)(nl_ptr - src) : src_len;
        size_t line_end = nl < src_len ? nl + 1 : src_len;

        size_t len = nl - pos;
        if (len > 0 && src[pos + len - 1] == '\r') {
            len--;
        }

        st = md_scan_line(&s, src + pos, len, (uint32_t)pos, (uint32_t)line_end, line_no);
        pos = line_end;
    }

    if (st == CBERG_OK && s.start_byte < src_len) {
        st = md_close_section(&s, (uint32_t)src_len, line_no);
    }

    chunk_occ_free(s.occ);
    if (st != CBERG_OK) {
        cberg_chunk_list_free(s.list);
        return st;
    }

    *out_list = s.list;
    return CBERG_OK;
}
