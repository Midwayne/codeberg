#ifndef CBERG_CACHELINE_H
#define CBERG_CACHELINE_H

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/*
 * Cache-line sizing for hot-path data structures. x86-64 and arm64 use 64-byte
 * lines; the library targets both, so we standardize on 64.
 */
#define CBERG_CACHE_LINE 64u
#define CBERG_CACHE_LINE_MASK (CBERG_CACHE_LINE - 1u)

static inline size_t cberg_cacheline_round(size_t bytes) {
    return (bytes + CBERG_CACHE_LINE_MASK) & ~((size_t)CBERG_CACHE_LINE_MASK);
}

/* Zero-filled allocation aligned to a cache line. Returns NULL on OOM. */
static inline void *cberg_cacheline_calloc(size_t count, size_t elem_size) {
    if (count != 0 && elem_size > SIZE_MAX / count) {
        return NULL;
    }
    size_t bytes = cberg_cacheline_round(count * elem_size);
    if (bytes == 0) {
        return NULL;
    }
    void *p = aligned_alloc(CBERG_CACHE_LINE, bytes);
    if (p != NULL) {
        memset(p, 0, bytes);
    }
    return p;
}

/*
 * Grow (or shrink) a cache-line-aligned array. `realloc` does not preserve
 * alignment, so this allocates fresh, copies `old_count` elements, and frees
 * the previous block. New capacity beyond `old_count` is zero-filled.
 */
static inline void *cberg_cacheline_realloc(void *p, size_t old_count, size_t new_count, size_t elem_size) {
    void *n = cberg_cacheline_calloc(new_count, elem_size);
    if (n == NULL) {
        return NULL;
    }
    if (p != NULL && old_count > 0 && elem_size > 0) {
        size_t copy = old_count < new_count ? old_count : new_count;
        if (copy > SIZE_MAX / elem_size) {
            free(n);
            return NULL;
        }
        memcpy(n, p, copy * elem_size);
        free(p);
    }
    return n;
}

static inline void cberg_cacheline_free(void *p) {
    free(p);
}

#endif /* CBERG_CACHELINE_H */
