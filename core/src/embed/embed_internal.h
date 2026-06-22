#ifndef CBERG_EMBED_INTERNAL_H
#define CBERG_EMBED_INTERNAL_H

#include "codeberg/codeberg.h"

cberg_status cberg_onnx_open(const cberg_embed_config *cfg, void **impl, size_t *dim);
cberg_status cberg_onnx_embed(void *impl, const char *const *texts, const size_t *lens, size_t count, float *out);
void cberg_onnx_close(void *impl);

void cberg_l2_normalize(float *vec, size_t dim);

#endif /* CBERG_EMBED_INTERNAL_H */
