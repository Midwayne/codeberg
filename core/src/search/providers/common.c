#include "common.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "codeberg/codeberg.h"
#include "hash_tag.h"

char *cberg_provider_name_from_path(const char *path) {
    char tag[CBERG_HASH_TAG_LEN + 1];
    cberg_hash_tag(path, tag);

    char *name = malloc(sizeof("codeberg_") + CBERG_HASH_TAG_LEN);
    if (name == NULL) {
        return NULL;
    }
    snprintf(name, sizeof("codeberg_") + CBERG_HASH_TAG_LEN, "codeberg_%s", tag);
    return name;
}

char *cberg_provider_vector_literal(const float *vector, size_t dim) {
    if (vector == NULL || dim == 0) {
        return NULL;
    }
    size_t cap = dim * 16 + 4;
    char *out = malloc(cap);
    if (out == NULL) {
        return NULL;
    }
    size_t pos = 0;
    out[pos++] = '[';
    for (size_t i = 0; i < dim; i++) {
        if (i > 0) {
            out[pos++] = ',';
        }
        int n = snprintf(out + pos, cap - pos, "%.9g", vector[i]);
        if (n < 0 || (size_t)n >= cap - pos) {
            size_t new_cap = cap * 2;
            char *grown = realloc(out, new_cap);
            if (grown == NULL) {
                free(out);
                return NULL;
            }
            out = grown;
            cap = new_cap;
            n = snprintf(out + pos, cap - pos, "%.9g", vector[i]);
            if (n < 0 || (size_t)n >= cap - pos) {
                free(out);
                return NULL;
            }
        }
        pos += (size_t)n;
    }
    if (pos + 2 > cap) {
        char *grown = realloc(out, pos + 2);
        if (grown == NULL) {
            free(out);
            return NULL;
        }
        out = grown;
    }
    out[pos++] = ']';
    out[pos] = '\0';
    return out;
}
