#ifndef CBERG_INDEX_INTERNAL_H
#define CBERG_INDEX_INTERNAL_H

#include <stddef.h>
#include <stdint.h>

#include "codeberg/codeberg.h"

typedef struct cberg_index_backend cberg_index_backend;

struct cberg_index {
    cberg_index_provider provider;
    size_t dim;
    size_t expansion_search;
    char *path;
    cberg_index_backend *backend;
};

struct cberg_index_backend {
    void *impl;
    void (*destroy)(void *impl);
    cberg_status (*add)(void *impl, uint64_t id, const float *vector, size_t dim);
    cberg_status (*remove)(void *impl, uint64_t id);
    cberg_status (*search)(void *impl, const float *query, size_t dim, size_t k, size_t expansion_search,
                           uint64_t *out_ids, float *out_scores, size_t *out_found);
    cberg_status (*save)(void *impl);
    cberg_status (*clear)(void *impl);
};

cberg_status cberg_index_usearch_open(const char *path, size_t dim, const cberg_index_config *config,
                                      cberg_index_backend **out_backend);
cberg_status cberg_index_qdrant_open(const char *path, size_t dim, const cberg_index_config *config,
                                     cberg_index_backend **out_backend);
cberg_status cberg_index_qdrant_wipe(const char *path, const cberg_index_config *config);

void cberg_index_backend_close(cberg_index_backend *backend);

#endif /* CBERG_INDEX_INTERNAL_H */
