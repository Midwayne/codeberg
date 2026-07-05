#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "index_internal.h"
#include "strutil.h"

void cberg_index_backend_close(cberg_index_backend *backend) {
    if (backend == NULL) {
        return;
    }
    if (backend->destroy != NULL) {
        backend->destroy(backend->impl);
    }
    free(backend);
}

cberg_status cberg_index_open(const char *path, size_t dim, const cberg_index_config *config, cberg_index **out_index) {
    if (path == NULL || dim == 0 || out_index == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_index = NULL;

    cberg_index_config defaults;
    cberg_index_config_default(&defaults);
    const cberg_index_config *cfg = config != NULL ? config : &defaults;

    cberg_index_backend *backend = NULL;
    cberg_status st;
    switch (cfg->provider) {
    case CBERG_INDEX_USEARCH:
        st = cberg_index_usearch_open(path, dim, cfg, &backend);
        break;
    case CBERG_INDEX_QDRANT:
        st = cberg_index_qdrant_open(path, dim, cfg, &backend);
        break;
    default:
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (st != CBERG_OK) {
        return st;
    }

    cberg_index *index = calloc(1, sizeof(*index));
    if (index == NULL) {
        cberg_index_backend_close(backend);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    index->provider = cfg->provider;
    index->dim = dim;
    index->expansion_search = cfg->expansion_search;
    index->path = cberg_strdup(path);
    index->backend = backend;
    if (index->path == NULL) {
        cberg_index_close(index);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    *out_index = index;
    return CBERG_OK;
}

cberg_status cberg_index_add(cberg_index *index, uint64_t id, const float *vector) {
    if (index == NULL || index->backend == NULL || vector == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    return index->backend->add(index->backend->impl, id, vector, index->dim);
}

cberg_status cberg_index_remove(cberg_index *index, uint64_t id) {
    if (index == NULL || index->backend == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    return index->backend->remove(index->backend->impl, id);
}

cberg_status cberg_index_search(cberg_index *index, const float *query, size_t k, const cberg_index_search_opts *opts,
                                uint64_t *out_ids, float *out_scores, size_t *out_found) {
    if (index == NULL || index->backend == NULL || query == NULL || out_ids == NULL || out_scores == NULL ||
        out_found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    size_t ef = index->expansion_search;
    if (opts != NULL && opts->expansion_search > 0) {
        ef = opts->expansion_search;
    }
    return index->backend->search(index->backend->impl, query, index->dim, k, ef, out_ids, out_scores, out_found);
}

cberg_status cberg_index_save(cberg_index *index) {
    if (index == NULL || index->backend == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    return index->backend->save(index->backend->impl);
}

cberg_status cberg_index_clear(cberg_index *index) {
    if (index == NULL || index->backend == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    return index->backend->clear(index->backend->impl);
}

cberg_status cberg_index_wipe(const char *path, size_t dim, const cberg_index_config *config) {
    if (path == NULL || dim == 0) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_index_config defaults;
    cberg_index_config_default(&defaults);
    const cberg_index_config *cfg = config != NULL ? config : &defaults;
    switch (cfg->provider) {
    case CBERG_INDEX_USEARCH:
        remove(path);
        return CBERG_OK;
    case CBERG_INDEX_QDRANT:
        return cberg_index_qdrant_wipe(path, cfg);
    default:
        return CBERG_ERR_INVALID_ARGUMENT;
    }
}

void cberg_index_close(cberg_index *index) {
    if (index == NULL) {
        return;
    }
    cberg_index_backend_close(index->backend);
    free(index->path);
    free(index);
}
