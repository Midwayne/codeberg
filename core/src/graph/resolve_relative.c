#include <stdio.h>
#include <string.h>

#include "graph_internal.h"

/* Normalize against the importing file, rejecting paths outside the repository. */
static int relative_path(const char *source, const char *import, char *out, size_t capacity) {
    const char *slash = strrchr(source, '/');
    size_t directory = slash != NULL ? (size_t)(slash - source + 1) : 0;
    char combined[4096];
    int length = snprintf(combined, sizeof combined, "%.*s%s", (int)directory, source, import);
    if (length < 0 || (size_t)length >= sizeof combined)
        return 0;

    size_t used = 0;
    char *state = NULL;
    for (char *part = strtok_r(combined, "/\\", &state); part != NULL; part = strtok_r(NULL, "/\\", &state)) {
        if (strcmp(part, ".") == 0)
            continue;
        if (strcmp(part, "..") == 0) {
            if (used == 0)
                return 0;
            while (used > 0 && out[used - 1] != '/')
                used--;
            if (used > 0)
                used--;
            continue;
        }

        size_t count = strlen(part);
        if (used + (used != 0) + count >= capacity)
            return 0;
        if (used != 0)
            out[used++] = '/';
        memcpy(out + used, part, count);
        used += count;
    }

    out[used] = '\0';
    return used != 0;
}

static int extension_candidate(const char *file, const char *stem, size_t length) {
    return strncmp(file, stem, length) == 0 && file[length] == '.' &&
           strchr(file + length, '/') == NULL;
}

/* Returns a matching file string borrowed from the import cache, or NULL. */
const char *cberg_graph_relative_file(const char *source, const char *import, char *const *files, size_t count) {
    char normalized[4096];
    if (!relative_path(source, import, normalized, sizeof normalized))
        return NULL;

    for (size_t i = 0; i < count; i++) {
        if (strcmp(files[i], normalized) == 0)
            return files[i];
    }

    const char *dot = strrchr(normalized, '.');
    const char *slash = strrchr(normalized, '/');
    if (dot != NULL && (slash == NULL || dot > slash)) {
        /* A .js specifier can point at TypeScript source. Other explicit
         * extensions are exact; never broaden missing headers or packages. */
        if (strcmp(dot, ".js") != 0 && strcmp(dot, ".jsx") != 0)
            return NULL;
        size_t prefix = (size_t)(dot - normalized);
        const char *found = NULL;
        for (size_t i = 0; i < count; i++) {
            if (strncmp(files[i], normalized, prefix) != 0)
                continue;
            if (strcmp(files[i] + prefix, ".ts") != 0 && strcmp(files[i] + prefix, ".tsx") != 0)
                continue;
            if (found != NULL)
                return NULL;
            found = files[i];
        }
        return found;
    }

    const char *found = NULL;
    size_t length = strlen(normalized);
    for (size_t i = 0; i < count; i++) {
        if (!extension_candidate(files[i], normalized, length))
            continue;
        if (found != NULL)
            return NULL;
        found = files[i];
    }
    if (found != NULL)
        return found;

    char entry[4096];
    int written = snprintf(entry, sizeof entry, "%s/index", normalized);
    if (written < 0 || (size_t)written >= sizeof entry)
        return NULL;
    for (size_t i = 0; i < count; i++) {
        int match = extension_candidate(files[i], entry, (size_t)written);
        if (strncmp(files[i], normalized, length) == 0 && files[i][length] == '/') {
            match |= strcmp(files[i] + length, "/__init__.py") == 0 || strcmp(files[i] + length, "/mod.rs") == 0;
        }
        if (!match)
            continue;
        if (found != NULL)
            return NULL;
        found = files[i];
    }

    return found;
}
