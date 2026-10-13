#define _POSIX_C_SOURCE 200809L
#include "codeberg/codeberg.h"

#undef NDEBUG
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(int argc, char **argv) {
    assert(setenv("CBERG_EMBED_WORKER", CBERG_WORKER_FIXTURE, 1) == 0);
    assert(setenv("CBERG_EMBED_BACKEND", argc > 1 ? argv[1] : "sentence-transformers", 1) == 0);

    cberg_embed_config cfg = {.provider = CBERG_EMBED_WORKER, .model_path = "/unused/model"};
    cberg_embedder *embedder = NULL;
    assert(cberg_embedder_open(&cfg, &embedder) == CBERG_OK);

    const char *texts[] = {"a"};
    size_t lens[] = {1};
    float *document = NULL;
    assert(cberg_embedder_embed(embedder, texts, lens, 1, &document) == CBERG_OK);
    assert(fabsf(document[0] - 0.7071068f) < 0.0001f);
    assert(document[1] == 0.0f);

    char path[] = "/tmp/cberg_gemma_XXXXXX";
    int fd = mkstemp(path);
    assert(fd >= 0);
    close(fd);
    remove(path);

    cberg_index *index = NULL;
    assert(cberg_index_open(path, 3, NULL, &index) == CBERG_OK);
    const float query_axis[] = {0.0f, 1.0f, 0.0f};
    assert(cberg_index_add(index, 1, document) == CBERG_OK);
    assert(cberg_index_add(index, 2, query_axis) == CBERG_OK);

    uint64_t id = 0;
    float score = 0.0f;
    size_t found = 0;
    assert(cberg_search_query(embedder, index, "a", 1, NULL, 1, &id, &score, &found) == CBERG_OK);
    assert(found == 1 && id == 2 && score > 0.99f);

    cberg_vectors_free(document);
    cberg_index_close(index);
    cberg_embedder_close(embedder);
    remove(path);
    puts("ok - embed_gemma_worker");
    return 0;
}
