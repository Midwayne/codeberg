#define _POSIX_C_SOURCE 200809L
#include "codeberg/codeberg.h"

#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    assert(setenv("CBERG_EMBED_WORKER", CBERG_WORKER_FIXTURE, 1) == 0);
    assert(setenv("CBERG_EMBED_BACKEND", "mlx", 1) == 0);
    cberg_embed_config cfg = {0};
    cfg.provider = CBERG_EMBED_WORKER;
    cfg.model_path = "/unused/model";
    cberg_embedder *embedder = NULL;
    assert(cberg_embedder_open(&cfg, &embedder) == CBERG_OK);
    assert(cberg_embedder_dim(embedder) == 3);
    const char *texts[] = {"a", "bbbb"};
    size_t lens[] = {1, 4};
    for (int attempt = 0; attempt < 2; attempt++) {
        float *vectors = NULL;
        assert(cberg_embedder_embed(embedder, texts, lens, 2, &vectors) == CBERG_OK);
        assert(fabsf(vectors[0] - 0.7071068f) < 0.0001f);
        assert(fabsf(vectors[3] - 4.0f / sqrtf(17.0f)) < 0.0001f);
        cberg_vectors_free(vectors);
    }
    cberg_embedder_close(embedder);
    puts("ok - embed_worker");
    return 0;
}
