#ifndef CBERG_EMBED_INTERNAL_H
#define CBERG_EMBED_INTERNAL_H

#include "codeberg/codeberg.h"

cberg_status cberg_onnx_open(const cberg_embed_config *cfg, void **impl, size_t *dim);
/* External worker implementation is available even when ONNX is not built. */
cberg_status cberg_worker_open(const cberg_embed_config *cfg, void **impl, size_t *dim);
cberg_status cberg_worker_embed(void *impl, const char *const *texts, const size_t *lens, size_t count, int query, float *out);
void cberg_worker_close(void *impl);
cberg_status cberg_onnx_embed(void *impl, const char *const *texts, const size_t *lens, size_t count, float *out);
void cberg_onnx_close(void *impl);

void cberg_l2_normalize(float *vec, size_t dim);

/* Query mode is private to search/indexer orchestration; the public C ABI stays
 * unchanged. Caller owns *out_vectors and frees it with cberg_vectors_free. */
cberg_status cberg_embedder_embed_query(cberg_embedder *embedder, const char *const *texts,
                                      const size_t *lens, size_t count, float **out_vectors);

#endif /* CBERG_EMBED_INTERNAL_H */
