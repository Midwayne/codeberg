#ifndef CBERG_BINIO_H
#define CBERG_BINIO_H

#include "codeberg/codeberg.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Fixed-width binary snapshot helpers shared by the chunk table and graph
 * sidecars. Little-endian-of-the-host fields; snapshots guard themselves with
 * a magic + version so a mismatch reads back as NOT_FOUND (cold rebuild), not
 * as garbage. NULL string length is encoded as 0xFFFFFFFF.
 */
#define CBERG_BIN_STR_NULL 0xFFFFFFFFu

static inline cberg_status cberg_bin_w_u32(FILE *f, uint32_t v) {
    return fwrite(&v, sizeof v, 1, f) == 1 ? CBERG_OK : CBERG_ERR_IO;
}

static inline cberg_status cberg_bin_w_u64(FILE *f, uint64_t v) {
    return fwrite(&v, sizeof v, 1, f) == 1 ? CBERG_OK : CBERG_ERR_IO;
}

static inline cberg_status cberg_bin_w_bytes(FILE *f, const void *p, size_t n) {
    return n == 0 || fwrite(p, 1, n, f) == n ? CBERG_OK : CBERG_ERR_IO;
}

static inline cberg_status cberg_bin_w_str(FILE *f, const char *s) {
    if (s == NULL) {
        return cberg_bin_w_u32(f, CBERG_BIN_STR_NULL);
    }
    size_t n = strlen(s);
    if (n >= CBERG_BIN_STR_NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_status st = cberg_bin_w_u32(f, (uint32_t)n);
    return st != CBERG_OK ? st : cberg_bin_w_bytes(f, s, n);
}

static inline cberg_status cberg_bin_r_exact(FILE *f, void *p, size_t n) {
    return n == 0 || fread(p, 1, n, f) == n ? CBERG_OK : CBERG_ERR_IO;
}

static inline cberg_status cberg_bin_r_u32(FILE *f, uint32_t *v) {
    return cberg_bin_r_exact(f, v, sizeof *v);
}

static inline cberg_status cberg_bin_r_u64(FILE *f, uint64_t *v) {
    return cberg_bin_r_exact(f, v, sizeof *v);
}

/* Reads a length-prefixed string into a malloc'd buffer (*out = NULL for the
 * NULL sentinel). Caller frees. */
static inline cberg_status cberg_bin_r_str(FILE *f, char **out) {
    uint32_t n = 0;
    cberg_status st = cberg_bin_r_u32(f, &n);
    if (st != CBERG_OK) {
        return st;
    }
    if (n == CBERG_BIN_STR_NULL) {
        *out = NULL;
        return CBERG_OK;
    }
    char *s = malloc((size_t)n + 1);
    if (s == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    st = cberg_bin_r_exact(f, s, n);
    if (st != CBERG_OK) {
        free(s);
        return st;
    }
    s[n] = '\0';
    *out = s;
    return CBERG_OK;
}

#endif /* CBERG_BINIO_H */
