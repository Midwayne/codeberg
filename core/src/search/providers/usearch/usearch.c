#include "../provider.h"
#include "../common.h"

#ifdef CBERG_WITH_USEARCH

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "strutil.h"
#include "usearch.h"

#define INITIAL_CAPACITY 1024

typedef struct usearch_backend {
    usearch_index_t idx;
    size_t dim;
    char *path;
} usearch_backend;

static int file_exists(const char *path) {
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return 0;
    }
    fclose(f);
    return 1;
}

static void usearch_backend_destroy(void *impl) {
    usearch_backend *b = impl;
    if (b == NULL) {
        return;
    }
    usearch_error_t err = NULL;
    usearch_free(b->idx, &err);
    free(b->path);
    free(b);
}

static cberg_status usearch_backend_add(void *impl, uint64_t id, const float *vector, size_t dim) {
    usearch_backend *b = impl;
    if (b == NULL || vector == NULL || dim != b->dim) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    usearch_error_t err = NULL;

    if (usearch_contains(b->idx, id, &err)) {
        usearch_remove(b->idx, id, &err);
        if (err != NULL) {
            return CBERG_ERR_INTERNAL;
        }
    }

    size_t size = usearch_size(b->idx, &err);
    size_t capacity = usearch_capacity(b->idx, &err);
    if (err != NULL) {
        return CBERG_ERR_INTERNAL;
    }
    if (size >= capacity) {
        size_t grown = capacity == 0 ? INITIAL_CAPACITY : capacity * 2;
        usearch_reserve(b->idx, grown, &err);
        if (err != NULL) {
            return CBERG_ERR_INTERNAL;
        }
    }

    usearch_add(b->idx, id, vector, usearch_scalar_f32_k, &err);
    if (err != NULL) {
        return CBERG_ERR_INTERNAL;
    }
    return CBERG_OK;
}

static cberg_status usearch_backend_remove(void *impl, uint64_t id) {
    usearch_backend *b = impl;
    if (b == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    usearch_error_t err = NULL;
    if (!usearch_contains(b->idx, id, &err)) {
        return CBERG_ERR_NOT_FOUND;
    }
    usearch_remove(b->idx, id, &err);
    if (err != NULL) {
        return CBERG_ERR_INTERNAL;
    }
    return CBERG_OK;
}

static cberg_status usearch_backend_search(void *impl, const float *query, size_t dim, size_t k,
                                           size_t expansion_search, uint64_t *out_ids, float *out_scores,
                                           size_t *out_found) {
    usearch_backend *b = impl;
    if (b == NULL || query == NULL || dim != b->dim || out_ids == NULL || out_scores == NULL || out_found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_found = 0;
    usearch_error_t err = NULL;

    if (expansion_search > 0) {
        usearch_change_expansion_search(b->idx, expansion_search, &err);
        if (err != NULL) {
            return CBERG_ERR_INTERNAL;
        }
    }

    size_t found = usearch_search(b->idx, query, usearch_scalar_f32_k, k, out_ids, out_scores, &err);
    if (err != NULL) {
        return CBERG_ERR_INTERNAL;
    }

    for (size_t i = 0; i < found; i++) {
        out_scores[i] = 1.0f - out_scores[i];
    }
    *out_found = found;
    return CBERG_OK;
}

static cberg_status usearch_backend_save(void *impl) {
    usearch_backend *b = impl;
    if (b == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char tmp[4096];
    int n = snprintf(tmp, sizeof tmp, "%s.tmp", b->path);
    if (n < 0 || (size_t)n >= sizeof tmp) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    usearch_error_t err = NULL;
    usearch_save(b->idx, tmp, &err);
    if (err != NULL) {
        remove(tmp);
        return CBERG_ERR_IO;
    }
    if (rename(tmp, b->path) != 0) {
        remove(tmp);
        return CBERG_ERR_IO;
    }
    return CBERG_OK;
}

static cberg_status usearch_backend_clear(void *impl) {
    usearch_backend *b = impl;
    if (b == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    usearch_error_t err = NULL;
    usearch_free(b->idx, &err);
    usearch_init_options_t opts;
    memset(&opts, 0, sizeof(opts));
    opts.metric_kind = usearch_metric_cos_k;
    opts.quantization = usearch_scalar_f32_k;
    opts.dimensions = b->dim;
    opts.multi = false;
    b->idx = usearch_init(&opts, &err);
    if (err != NULL || b->idx == NULL) {
        return CBERG_ERR_INTERNAL;
    }
    usearch_reserve(b->idx, INITIAL_CAPACITY, &err);
    if (err != NULL) {
        return CBERG_ERR_INTERNAL;
    }
    remove(b->path);
    return CBERG_OK;
}

static cberg_status usearch_open(const char *path, size_t dim, const cberg_index_config *config,
                                 cberg_index_backend **out_backend) {
    if (path == NULL || dim == 0 || out_backend == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_backend = NULL;

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

    usearch_backend *b = calloc(1, sizeof(*b));
    if (b == NULL) {
        usearch_free(idx, &err);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    b->idx = idx;
    b->dim = dim;
    b->path = cberg_strdup(path);
    if (b->path == NULL) {
        usearch_backend_destroy(b);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_index_backend *backend =
        cberg_index_backend_new(b, usearch_backend_destroy, usearch_backend_add, usearch_backend_remove,
                                usearch_backend_search, usearch_backend_save, usearch_backend_clear);
    if (backend == NULL) {
        usearch_backend_destroy(b);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    *out_backend = backend;
    return CBERG_OK;
}

static cberg_status usearch_wipe(const char *path, size_t dim, const cberg_index_config *config) {
    (void)dim;
    (void)config;
    if (path == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    remove(path);
    return CBERG_OK;
}

const cberg_index_provider_ops cberg_usearch_provider = {
    .id = CBERG_INDEX_USEARCH,
    .name = "usearch",
    .rebuild_inplace = 0,
    .open = usearch_open,
    .wipe = usearch_wipe,
};

#else /* !CBERG_WITH_USEARCH */

static cberg_status usearch_open(const char *path, size_t dim, const cberg_index_config *config,
                                 cberg_index_backend **out_backend) {
    (void)path;
    (void)dim;
    (void)config;
    if (out_backend != NULL) {
        *out_backend = NULL;
    }
    return CBERG_ERR_NOT_IMPLEMENTED;
}

static cberg_status usearch_wipe(const char *path, size_t dim, const cberg_index_config *config) {
    (void)path;
    (void)dim;
    (void)config;
    return CBERG_ERR_NOT_IMPLEMENTED;
}

const cberg_index_provider_ops cberg_usearch_provider = {
    .id = CBERG_INDEX_USEARCH,
    .name = "usearch",
    .rebuild_inplace = 0,
    .open = usearch_open,
    .wipe = usearch_wipe,
};

#endif /* CBERG_WITH_USEARCH */
