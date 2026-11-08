#include "chunk_keys.h"

#include "strmap.h"

#include <stdio.h>
#include <stdlib.h>

/* Keys embed the kind's numeric value, and keys are persisted in the chunk
 * table and every vector index: renumbering a kind silently re-ids every chunk. */
_Static_assert(CBERG_CHUNK_UNKNOWN == 0, "chunk kind values are persisted in chunk keys");
_Static_assert(CBERG_CHUNK_FUNCTION == 1, "chunk kind values are persisted in chunk keys");
_Static_assert(CBERG_CHUNK_METHOD == 2, "chunk kind values are persisted in chunk keys");
_Static_assert(CBERG_CHUNK_CLASS == 3, "chunk kind values are persisted in chunk keys");
_Static_assert(CBERG_CHUNK_STRUCT == 4, "chunk kind values are persisted in chunk keys");
_Static_assert(CBERG_CHUNK_INTERFACE == 5, "chunk kind values are persisted in chunk keys");
_Static_assert(CBERG_CHUNK_WINDOW == 6, "chunk kind values are persisted in chunk keys");
_Static_assert(CBERG_CHUNK_SECTION == 7, "chunk kind values are persisted in chunk keys");
_Static_assert(CBERG_CHUNK_KEY == 8, "chunk kind values are persisted in chunk keys");

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

static cberg_status chunk_format_ident(char *buf, size_t cap, const char *path, cberg_chunk_kind kind, const char *symbol) {
    const char *sym = symbol != NULL ? symbol : "";
    int n = snprintf(buf, cap, "%s::%d::%s", path, (int)kind, sym);
    if (n < 0 || (size_t)n >= cap) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    return CBERG_OK;
}

bool chunk_ident_fits(const char *path, cberg_chunk_kind kind, size_t sym_len) {
    int prefix = snprintf(NULL, 0, "%s::%d::", path, (int)kind);
    if (prefix < 0) {
        return false;
    }

    return (size_t)prefix + sym_len < CBERG_CHUNK_IDENT_MAX;
}

cberg_status chunk_format_key(char *buf, size_t cap, const char *path, cberg_chunk_kind kind, const char *symbol, uint32_t index) {
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

cberg_status chunk_occ_next(chunk_occ_tracker *tracker, const char *path, cberg_chunk_kind kind, const char *symbol, uint32_t *out_index) {
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
