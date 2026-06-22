#include "codeberg/codeberg.h"

#ifdef CBERG_WITH_USEARCH

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "usearch.h"

#include "strutil.h"

#define INITIAL_CAPACITY 1024

struct cberg_index {
    usearch_index_t idx;
    size_t dim;
    size_t expansion_search;
    char *path;
};

static int file_exists(const char *path) {
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return 0;
    }
    fclose(f);
    return 1;
}

cberg_status cberg_index_open(const char *path, size_t dim, const cberg_index_config *config,
                              cberg_index **out_index) {
    if (path == NULL || dim == 0 || out_index == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_index = NULL;

    cberg_index_config defaults;
    cberg_index_config_default(&defaults);
    const cberg_index_config *cfg = config != NULL ? config : &defaults;

    usearch_init_options_t opts;
    memset(&opts, 0, sizeof(opts));
    opts.metric_kind = usearch_metric_cos_k;
    opts.quantization = usearch_scalar_f32_k;
    opts.dimensions = dim;
    opts.connectivity = cfg->connectivity;
    opts.expansion_add = cfg->expansion_add;
    opts.expansion_search = cfg->expansion_search;
    opts.multi = false;

    usearch_error_t err = NULL;
    usearch_index_t idx = usearch_init(&opts, &err);
    if (err != NULL || idx == NULL) {
        return CBERG_ERR_INTERNAL;
    }

    if (file_exists(path)) {
        usearch_load(idx, path, &err);
        if (err != NULL) {
            usearch_free(idx, &err);
            return CBERG_ERR_IO;
        }
    } else {
        usearch_reserve(idx, INITIAL_CAPACITY, &err);
        if (err != NULL) {
            usearch_free(idx, &err);
            return CBERG_ERR_INTERNAL;
        }
    }

    cberg_index *index = calloc(1, sizeof(*index));
    if (index == NULL) {
        usearch_free(idx, &err);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    index->idx = idx;
    index->dim = dim;
    index->expansion_search = cfg->expansion_search;
    index->path = cberg_strdup(path);
    if (index->path == NULL) {
        usearch_free(idx, &err);
        free(index);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    *out_index = index;
    return CBERG_OK;
}

cberg_status cberg_index_add(cberg_index *index, uint64_t id, const float *vector) {
    if (index == NULL || vector == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    usearch_error_t err = NULL;

    if (usearch_contains(index->idx, id, &err)) {
        usearch_remove(index->idx, id, &err);
        if (err != NULL) {
            return CBERG_ERR_INTERNAL;
        }
    }

    size_t size = usearch_size(index->idx, &err);
    size_t capacity = usearch_capacity(index->idx, &err);
    if (err != NULL) {
        return CBERG_ERR_INTERNAL;
    }
    if (size >= capacity) {
        size_t grown = capacity == 0 ? INITIAL_CAPACITY : capacity * 2;
        usearch_reserve(index->idx, grown, &err);
        if (err != NULL) {
            return CBERG_ERR_INTERNAL;
        }
    }

    usearch_add(index->idx, id, vector, usearch_scalar_f32_k, &err);
    if (err != NULL) {
        return CBERG_ERR_INTERNAL;
    }
    return CBERG_OK;
}

cberg_status cberg_index_remove(cberg_index *index, uint64_t id) {
    if (index == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    usearch_error_t err = NULL;
    if (!usearch_contains(index->idx, id, &err)) {
        return CBERG_ERR_NOT_FOUND;
    }
    usearch_remove(index->idx, id, &err);
    if (err != NULL) {
        return CBERG_ERR_INTERNAL;
    }
    return CBERG_OK;
}

cberg_status cberg_index_search(cberg_index *index, const float *query, size_t k, const cberg_index_search_opts *opts,
                                uint64_t *out_ids, float *out_scores, size_t *out_found) {
    if (index == NULL || query == NULL || out_ids == NULL || out_scores == NULL || out_found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_found = 0;
    usearch_error_t err = NULL;

    size_t prev_ef = index->expansion_search;
    size_t query_ef = prev_ef;
    if (opts != NULL && opts->expansion_search > 0) {
        query_ef = opts->expansion_search;
    }
    if (query_ef != prev_ef) {
        usearch_change_expansion_search(index->idx, query_ef, &err);
        if (err != NULL) {
            return CBERG_ERR_INTERNAL;
        }
    }

    size_t found = usearch_search(index->idx, query, usearch_scalar_f32_k, k, out_ids, out_scores, &err);

    if (query_ef != prev_ef) {
        usearch_change_expansion_search(index->idx, prev_ef, &err);
        if (err != NULL) {
            return CBERG_ERR_INTERNAL;
        }
    }
    if (err != NULL) {
        return CBERG_ERR_INTERNAL;
    }

    for (size_t i = 0; i < found; i++) {
        out_scores[i] = 1.0f - out_scores[i];
    }
    *out_found = found;
    return CBERG_OK;
}

cberg_status cberg_index_save(cberg_index *index) {
    if (index == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    usearch_error_t err = NULL;
    usearch_save(index->idx, index->path, &err);
    if (err != NULL) {
        return CBERG_ERR_IO;
    }
    return CBERG_OK;
}

void cberg_index_close(cberg_index *index) {
    if (index == NULL) {
        return;
    }
    usearch_error_t err = NULL;
    usearch_free(index->idx, &err);
    free(index->path);
    free(index);
}

#endif /* CBERG_WITH_USEARCH */
