#include "chunk_keys.h"

#include "strmap.h"

#include <stdio.h>
#include <stdlib.h>

struct chunk_occ_tracker {
    cberg_strmap *map;
};

chunk_occ_tracker *chunk_occ_new(void) {
    chunk_occ_tracker *tracker = calloc(1, sizeof(chunk_occ_tracker));
    if (tracker == NULL) {
        return NULL;
    }
    tracker->map = cberg_strmap_new(64);
    if (tracker->map == NULL) {
        free(tracker);
        return NULL;
    }
    return tracker;
}

void chunk_occ_free(chunk_occ_tracker *tracker) {
    if (tracker == NULL) {
        return;
    }
    cberg_strmap_free(tracker->map);
    free(tracker);
}

cberg_status chunk_format_ident(char *buf, size_t cap, const char *path, cberg_chunk_kind kind, const char *symbol) {
    const char *sym = symbol != NULL ? symbol : "";
    int n = snprintf(buf, cap, "%s::%d::%s", path, (int)kind, sym);
    if (n < 0 || (size_t)n >= cap) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    return CBERG_OK;
}

cberg_status chunk_format_key(char *buf, size_t cap, const char *path, cberg_chunk_kind kind, const char *symbol,
                              uint32_t index) {
    char ident[CBERG_CHUNK_IDENT_MAX];
    cberg_status st = chunk_format_ident(ident, sizeof(ident), path, kind, symbol);
    if (st != CBERG_OK) {
        return st;
    }
    int n = snprintf(buf, cap, "%s#%u", ident, index);
    if (n < 0 || (size_t)n >= cap) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    return CBERG_OK;
}

cberg_status chunk_occ_next(chunk_occ_tracker *tracker, const char *path, cberg_chunk_kind kind, const char *symbol,
                            uint32_t *out_index) {
    if (tracker == NULL || path == NULL || out_index == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char ident[CBERG_CHUNK_IDENT_MAX];
    cberg_status st = chunk_format_ident(ident, sizeof(ident), path, kind, symbol);
    if (st != CBERG_OK) {
        return st;
    }

    uint64_t count = 0;
    if (cberg_strmap_get(tracker->map, ident, &count)) {
        *out_index = (uint32_t)count;
        count++;
        return cberg_strmap_set(tracker->map, ident, count);
    }

    *out_index = 0;
    return cberg_strmap_set(tracker->map, ident, 1);
}
