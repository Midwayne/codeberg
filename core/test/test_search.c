#define _POSIX_C_SOURCE 200809L

#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define SKIP 77

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

int main(void) {
    const char *model = getenv("CBERG_TEST_MODEL");
    if (model == NULL || model[0] == '\0') {
        printf("skip - CBERG_TEST_MODEL not set\n");
        return SKIP;
    }

    char path[] = "/tmp/cberg_search_XXXXXX";
    int fd = mkstemp(path);
    if (fd >= 0) {
        close(fd);
        remove(path);
    }

    cberg_embed_config ecfg = {0};
    ecfg.provider = CBERG_EMBED_ONNX;
    ecfg.model_path = model;

    cberg_embedder *emb = NULL;
    cberg_status st = cberg_embedder_open(&ecfg, &emb);
    CHECK(st == CBERG_OK && emb != NULL, "embedder opens");
    if (emb == NULL) {
        return 1;
    }
    size_t dim = cberg_embedder_dim(emb);

    cberg_index *idx = NULL;
    st = cberg_index_open(path, dim, NULL, &idx);
    CHECK(st == CBERG_OK && idx != NULL, "index opens");
    if (idx == NULL) {
        cberg_embedder_close(emb);
        return 1;
    }

    const char *chunks[] = {
        "def add(a, b):\n    return a + b",
        "def sum_two(x, y):\n    return x + y",
        "func quicksort(arr []int) []int { /* sort */ }",
    };
    size_t lens[3];
    for (int i = 0; i < 3; i++) {
        lens[i] = strlen(chunks[i]);
    }

    float *vecs = NULL;
    st = cberg_embedder_embed(emb, chunks, lens, 3, &vecs);
    CHECK(st == CBERG_OK && vecs != NULL, "batch embed");
    if (vecs == NULL) {
        cberg_index_close(idx);
        cberg_embedder_close(emb);
        return 1;
    }

    for (int i = 0; i < 3; i++) {
        CHECK(cberg_index_add(idx, (uint64_t)(i + 1), vecs + (size_t)i * dim) == CBERG_OK, "index add");
    }
    cberg_vectors_free(vecs);

    const char *query = "function that adds two numbers";
    uint64_t ids[2];
    float scores[2];
    size_t found = 0;
    st = cberg_search_query(emb, idx, query, strlen(query), NULL, 2, ids, scores, &found);
    CHECK(st == CBERG_OK && found >= 2, "semantic search returns neighbors");
    CHECK(ids[0] == 1 || ids[0] == 2, "top hit is an addition function");
    CHECK(scores[0] >= scores[1], "scores descending");

    /* cberg_search_vector with a pre-embedded query must match
     * cberg_search_query exactly (it is the same path minus the embed). */
    const char *qtexts[1] = {query};
    size_t qlens[1] = {strlen(query)};
    float *qvec = NULL;
    st = cberg_embedder_embed(emb, qtexts, qlens, 1, &qvec);
    CHECK(st == CBERG_OK && qvec != NULL, "query embeds");
    if (qvec != NULL) {
        uint64_t vids[2];
        float vscores[2];
        size_t vfound = 0;
        st = cberg_search_vector(idx, qvec, NULL, 2, vids, vscores, &vfound);
        CHECK(st == CBERG_OK && vfound == found, "vector search finds the same count");
        for (size_t i = 0; i < vfound && i < found; i++) {
            CHECK(vids[i] == ids[i], "vector search matches query search ids");
            CHECK(vscores[i] == scores[i], "vector search matches query search scores");
        }
        cberg_vectors_free(qvec);
    }

    cberg_index_close(idx);
    cberg_embedder_close(emb);
    remove(path);

    if (failures == 0) {
        printf("ok - search\n");
        return 0;
    }
    return 1;
}
