#ifndef CBERG_FNV_H
#define CBERG_FNV_H

#include <stdint.h>

/*
 * Fast string hash for in-memory map bucket indices (cberg_strmap).
 * Content digests use XXH3 via cberg_hash — not FNV.
 */
static inline uint64_t cberg_fnv1a(const char *s) {
    uint64_t h = 14695981039346656037ULL;
    while (s != NULL && *s != '\0') {
        h ^= (unsigned char)*s++;
        h *= 1099511628211ULL;
    }
    return h;
}

#endif /* CBERG_FNV_H */
