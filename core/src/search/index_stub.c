#include "codeberg/codeberg.h"

cberg_status cberg_index_open(const char *path, size_t dim, const cberg_index_config *config,
                              cberg_index **out_index) {
    (void)path;
    (void)dim;
    (void)config;
    if (out_index != NULL) {
        *out_index = NULL;
    }
    return CBERG_ERR_NOT_IMPLEMENTED;
}

cberg_status cberg_index_add(cberg_index *index, uint64_t id, const float *vector) {
    (void)index;
    (void)id;
    (void)vector;
    return CBERG_ERR_NOT_IMPLEMENTED;
}

cberg_status cberg_index_remove(cberg_index *index, uint64_t id) {
    (void)index;
    (void)id;
    return CBERG_ERR_NOT_IMPLEMENTED;
}

cberg_status cberg_index_search(cberg_index *index, const float *query, size_t k, const cberg_index_search_opts *opts,
                                uint64_t *out_ids, float *out_scores, size_t *out_found) {
    (void)index;
    (void)query;
    (void)k;
    (void)opts;
    (void)out_ids;
    (void)out_scores;
    if (out_found != NULL) {
        *out_found = 0;
    }
    return CBERG_ERR_NOT_IMPLEMENTED;
}

cberg_status cberg_index_save(cberg_index *index) {
    (void)index;
    return CBERG_ERR_NOT_IMPLEMENTED;
}

void cberg_index_close(cberg_index *index) {
    (void)index;
}
