#ifndef CBERG_SEARCH_PROVIDER_H
#define CBERG_SEARCH_PROVIDER_H

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
    cberg_status (*search)(void *impl, const float *query, size_t dim, size_t k, size_t expansion_search, uint64_t *out_ids, float *out_scores, size_t *out_found);
    cberg_status (*save)(void *impl);
    cberg_status (*clear)(void *impl);
};

typedef struct cberg_index_provider_ops {
    cberg_index_provider id;
    const char *name;
    int rebuild_inplace; /* 1 = cberg_index_clear + repopulate; 0 = temp-file swap */
    cberg_status (*open)(const char *path, size_t dim, const cberg_index_config *config, cberg_index_backend **out);
    cberg_status (*wipe)(const char *path, size_t dim, const cberg_index_config *config);
} cberg_index_provider_ops;

cberg_index_backend *cberg_index_backend_new(
    void *impl, void (*destroy)(void *), cberg_status (*add)(void *, uint64_t, const float *, size_t), cberg_status (*remove)(void *, uint64_t), cberg_status (*search)(void *, const float *, size_t, size_t, size_t, uint64_t *, float *, size_t *), cberg_status (*save)(void *), cberg_status (*clear)(void *));

void cberg_index_backend_close(cberg_index_backend *backend);

#endif /* CBERG_SEARCH_PROVIDER_H */
