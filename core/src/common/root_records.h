#ifndef CBERG_ROOT_RECORDS_H
#define CBERG_ROOT_RECORDS_H

#include <stdbool.h>
#include <stddef.h>
#include <string.h>

/* One "<key>\t<path>" record of CBERG_INDEX_ROOT_ENV. Spans borrow the value. */
typedef struct cberg_root_record {
    const char *key;
    size_t key_len;
    const char *path;
    size_t path_len;
} cberg_root_record;

/*
 * Reads the record at *cursor and advances past its newline. Returns false at
 * the end of the value. A malformed record (no tab, empty key, or empty path)
 * is returned with key == NULL so the caller can skip it. Records are not
 * trimmed: the daemon's encoder does not add surrounding space.
 */
static inline bool cberg_root_record_next(const char **cursor, cberg_root_record *out) {
    const char *line = *cursor;
    if (line == NULL || line[0] == '\0') {
        return false;
    }

    size_t len = strcspn(line, "\n");
    *cursor = line[len] == '\n' ? line + len + 1 : line + len;

    const char *tab = memchr(line, '\t', len);
    size_t key_len = tab != NULL ? (size_t)(tab - line) : 0;
    if (tab == NULL || key_len == 0 || key_len + 1 >= len) {
        *out = (cberg_root_record){0};
        return true;
    }

    out->key = line;
    out->key_len = key_len;
    out->path = tab + 1;
    out->path_len = len - key_len - 1;
    return true;
}

#endif /* CBERG_ROOT_RECORDS_H */
