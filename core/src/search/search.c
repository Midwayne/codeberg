#include "codeberg/codeberg.h"

#include <stdlib.h>

void cberg_search_config_default(cberg_search_config *config) {
    if (config == NULL) {
        return;
    }
    config->oversample = 4;
    config->min_expansion_search = 64;
}

cberg_status cberg_search_vector(cberg_index *index, const float *query_vec, const cberg_search_config *config, size_t k, uint64_t *out_ids, float *out_scores, size_t *out_found) {
    if (index == NULL || query_vec == NULL || out_ids == NULL || out_scores == NULL || out_found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_found = 0;
    if (k == 0) {
        return CBERG_OK;
    }

    cberg_search_config defaults;
    cberg_search_config_default(&defaults);
    const cberg_search_config *cfg = config != NULL ? config : &defaults;

    size_t ef = cfg->min_expansion_search;
    size_t scaled = k * cfg->oversample;
    if (scaled > ef) {
        ef = scaled;
    }

    cberg_index_search_opts opts = {.expansion_search = ef};
    return cberg_index_search(index, query_vec, k, &opts, out_ids, out_scores, out_found);
}

cberg_status cberg_search_query(cberg_embedder *embedder, cberg_index *index, const char *query, size_t query_len, const cberg_search_config *config, size_t k, uint64_t *out_ids, float *out_scores, size_t *out_found) {
    if (embedder == NULL || index == NULL || query == NULL || out_ids == NULL || out_scores == NULL ||
        out_found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_found = 0;
    if (k == 0) {
        return CBERG_OK;
    }

    const char *texts[1] = {query};
    size_t lens[1] = {query_len};
    float *vectors = NULL;
    cberg_status st = cberg_embedder_embed(embedder, texts, lens, 1, &vectors);
    if (st != CBERG_OK) {
        return st;
    }

    st = cberg_search_vector(index, vectors, config, k, out_ids, out_scores, out_found);
    cberg_vectors_free(vectors);
    return st;
}
