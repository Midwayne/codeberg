#include "pathglob.h"

#include <fnmatch.h>
#include <stdio.h>
#include <string.h>

#define GLOB_MAX 1024
#define GLOB_SEGS_MAX 128
#define GLOB_BRACE_DEPTH 8

typedef struct {
    const char *items[GLOB_SEGS_MAX];
    size_t len;
} seg_list;

/* Splits buf in place on '/'; false when there are too many segments. */
static bool split_segments(char *buf, seg_list *out) {
    out->len = 0;
    char *seg = buf;

    for (;;) {
        if (out->len == GLOB_SEGS_MAX) {
            return false;
        }

        char *slash = strchr(seg, '/');
        out->items[out->len++] = seg;
        if (slash == NULL) {
            return true;
        }

        *slash = '\0';
        seg = slash + 1;
    }
}

/* A "**" segment matches zero or more whole segments, except as the last
 * pattern segment, where it must cover at least one ("dir/" + "**" is what
 * is inside dir, not dir itself). */
static bool match_segments(const seg_list *pat, size_t pi, const seg_list *path, size_t xi) {
    if (pi == pat->len) {
        return xi == path->len;
    }

    if (strcmp(pat->items[pi], "**") == 0) {
        size_t from = pi + 1 == pat->len ? xi + 1 : xi;
        for (size_t k = from; k <= path->len; k++) {
            if (match_segments(pat, pi + 1, path, k)) {
                return true;
            }
        }
        return false;
    }

    if (xi == path->len || fnmatch(pat->items[pi], path->items[xi], 0) != 0) {
        return false;
    }
    return match_segments(pat, pi + 1, path, xi + 1);
}

static bool match_plain(const char *glob, const char *path) {
    bool anchored = glob[0] == '/';
    if (anchored) {
        glob++;
    }

    if (!anchored && strchr(glob, '/') == NULL) {
        const char *slash = strrchr(path, '/');
        return fnmatch(glob, slash != NULL ? slash + 1 : path, 0) == 0;
    }

    char gbuf[GLOB_MAX];
    char pbuf[GLOB_MAX];
    if (strlen(glob) >= sizeof(gbuf) || strlen(path) >= sizeof(pbuf)) {
        return fnmatch(glob, path, FNM_PATHNAME) == 0;
    }
    strcpy(gbuf, glob);
    strcpy(pbuf, path);

    seg_list pat;
    seg_list segs;
    if (!split_segments(gbuf, &pat) || !split_segments(pbuf, &segs)) {
        return fnmatch(glob, path, FNM_PATHNAME) == 0;
    }
    return match_segments(&pat, 0, &segs, 0);
}

/* Finds the first top-level {…} group; false when there is none. */
static bool find_braces(const char *glob, size_t *open, size_t *close) {
    int depth = 0;

    for (size_t i = 0; glob[i] != '\0'; i++) {
        if (glob[i] == '\\' && glob[i + 1] != '\0') {
            i++;
        } else if (glob[i] == '{') {
            if (depth++ == 0) {
                *open = i;
            }
        } else if (glob[i] == '}' && depth > 0 && --depth == 0) {
            *close = i;
            return true;
        }
    }
    return false;
}

/* Expands the first brace group alternative by alternative. */
static bool match_braces(const char *glob, const char *path, int depth) {
    size_t open = 0;
    size_t close = 0;
    if (depth >= GLOB_BRACE_DEPTH || !find_braces(glob, &open, &close)) {
        return match_plain(glob, path);
    }

    size_t start = open + 1;
    int nest = 0;
    for (size_t i = start; i <= close; i++) {
        char c = glob[i];
        if (c == '{') {
            nest++;
        } else if (c == '}' && nest > 0 && i < close) {
            nest--;
        } else if ((c == ',' && nest == 0) || i == close) {
            char alt[GLOB_MAX];
            int n = snprintf(alt, sizeof(alt), "%.*s%.*s%s", (int)open, glob, (int)(i - start), glob + start, glob + close + 1);
            if (n > 0 && (size_t)n < sizeof(alt) && match_braces(alt, path, depth + 1)) {
                return true;
            }
            start = i + 1;
        }
    }
    return false;
}

bool cberg_path_glob_match(const char *glob, const char *path) {
    if (glob == NULL || glob[0] == '\0') {
        return true;
    }
    if (path == NULL) {
        return false;
    }

    bool negate = glob[0] == '!';
    if (negate) {
        glob++;
    }

    return match_braces(glob, path, 0) != negate;
}
