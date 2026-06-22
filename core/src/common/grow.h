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

#endif /* CBERG_GROW_H */
