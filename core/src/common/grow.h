#ifndef CBERG_GROW_H
#define CBERG_GROW_H

#include <stddef.h>

static inline size_t cberg_grow_cap(size_t cap, size_t want, size_t initial) {
    if (want <= cap) {
        return cap;
    }
    size_t next = cap == 0 ? initial : cap * 2;
    while (next < want) {
        next *= 2;
    }
    return next;
}

/* Smallest power of two >= n (minimum 64). Used for open-addressing map buckets. */
static inline size_t cberg_round_pow2(size_t n) {
    size_t p = 64;
    while (p < n) {
        p <<= 1;
    }
    return p;
}

#endif /* CBERG_GROW_H */
