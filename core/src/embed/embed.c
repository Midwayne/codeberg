#include "codeberg/codeberg.h"

#include <math.h>
#include <stdlib.h>

#include "embed_internal.h"

struct cberg_embedder {
    cberg_embed_provider provider;
    size_t dim;
    void *impl;
};

void cberg_l2_normalize(float *vec, size_t dim) {
    double sum = 0.0;
    for (size_t i = 0; i < dim; i++) {
        sum += (double)vec[i] * (double)vec[i];
    }
    if (sum <= 0.0) {
        return;
    }
    float inv = (float)(1.0 / sqrt(sum));
    for (size_t i = 0; i < dim; i++) {
        vec[i] *= inv;
    }
}

cberg_status cberg_embedder_open(const cberg_embed_config *config, cberg_embedder **out_embedder) {
    if (config == NULL || out_embedder == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_embedder = NULL;

    void *impl = NULL;
    size_t dim = 0;
    cberg_status st;
    switch (config->provider) {
    case CBERG_EMBED_ONNX:
#ifdef CBERG_WITH_ONNX
        st = cberg_onnx_open(config, &impl, &dim);
#else
        st = CBERG_ERR_NOT_IMPLEMENTED;
#endif
        break;
    default:
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (st != CBERG_OK) {
        return st;
    }

    cberg_embedder *e = calloc(1, sizeof(*e));
    if (e == NULL) {
#ifdef CBERG_WITH_ONNX
        cberg_onnx_close(impl);
#endif
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    e->provider = config->provider;
    e->dim = dim;
    e->impl = impl;
    *out_embedder = e;
    return CBERG_OK;
}

size_t cberg_embedder_dim(const cberg_embedder *embedder) {
    return embedder == NULL ? 0 : embedder->dim;
}

cberg_status cberg_embedder_embed(cberg_embedder *embedder, const char *const *texts, const size_t *text_lens,
                                  size_t count, float **out_vectors) {
    if (embedder == NULL || texts == NULL || text_lens == NULL || out_vectors == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_vectors = NULL;
    if (count == 0) {
        return CBERG_OK;
    }

    float *vectors = calloc(count * embedder->dim, sizeof(float));
    if (vectors == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st;
    switch (embedder->provider) {
    case CBERG_EMBED_ONNX:
#ifdef CBERG_WITH_ONNX
        st = cberg_onnx_embed(embedder->impl, texts, text_lens, count, vectors);
#else
        st = CBERG_ERR_NOT_IMPLEMENTED;
#endif
        break;
    default:
        st = CBERG_ERR_INVALID_ARGUMENT;
    }
    if (st != CBERG_OK) {
        free(vectors);
        return st;
    }
    *out_vectors = vectors;
    return CBERG_OK;
}

void cberg_vectors_free(float *vectors) {
    free(vectors);
}

void cberg_embedder_close(cberg_embedder *embedder) {
    if (embedder == NULL) {
        return;
    }
    switch (embedder->provider) {
    case CBERG_EMBED_ONNX:
#ifdef CBERG_WITH_ONNX
        cberg_onnx_close(embedder->impl);
#endif
        break;
    }
    free(embedder);
}
