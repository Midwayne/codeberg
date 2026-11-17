#include "codeberg/codeberg.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SKIP 77

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

static float dot(const float *a, const float *b, size_t dim) {
    float s = 0.0f;
    for (size_t i = 0; i < dim; i++) {
        s += a[i] * b[i];
    }
    return s;
}

/* Two bodies that share ~300 tokens and differ only after them must embed
 * differently: the window covers 512 tokens, so a function's tail (error
 * handling, the return) still shapes its vector. */
static void check_window_reaches_past_256_tokens(cberg_embedder *emb, size_t dim) {
    size_t cap = 8192;
    char *a = malloc(cap);
    char *b = malloc(cap);
    size_t off = (size_t)snprintf(a, cap, "def score(values, weights):\n    total = 0\n");
    for (int i = 0; i < 30; i++) {
        off += (size_t)snprintf(a + off, cap - off, "    total += values[%d] * weights[%d]\n", i, i);
    }
    memcpy(b, a, off + 1);
    snprintf(a + off, cap - off, "    return total\n");
    snprintf(b + off, cap - off, "    raise TimeoutError('lease expired before commit')\n");

    const char *texts[] = {a, b};
    size_t lens[] = {strlen(a), strlen(b)};
    float *vecs = NULL;
    cberg_status st = cberg_embedder_embed(emb, texts, lens, 2, &vecs);
    CHECK(st == CBERG_OK && vecs != NULL, "long bodies embed");

    if (vecs != NULL) {
        float sim = dot(vecs, vecs + dim, dim);
        printf("cosine(long bodies differing after ~300 tokens)=%.6f\n", sim);
        CHECK(sim < 0.9999f, "tokens past 256 change the embedding");
    }

    cberg_vectors_free(vecs);
    free(a);
    free(b);
}

int main(void) {
    const char *model = getenv("CBERG_TEST_MODEL");
    if (model == NULL || model[0] == '\0') {
        printf("skip - CBERG_TEST_MODEL not set\n");
        return SKIP;
    }

    cberg_embed_config cfg = {0};
    cfg.provider = CBERG_EMBED_ONNX;
    cfg.model_path = model;

    cberg_embedder *emb = NULL;
    cberg_status st = cberg_embedder_open(&cfg, &emb);
    CHECK(st == CBERG_OK, "embedder opens");
    if (st != CBERG_OK) {
        return 1;
    }
    size_t dim = cberg_embedder_dim(emb);
    CHECK(dim == 768, "jina-v2-base-code dim is 768");

    const char *texts[] = {
        "def add(a, b):\n    return a + b",
        "def sum_two(x, y):\n    return x + y",
        "func quicksort(arr []int) []int { /* sort in place */ }",
    };
    size_t lens[3];
    for (int i = 0; i < 3; i++) {
        lens[i] = strlen(texts[i]);
    }

    float *vecs = NULL;
    st = cberg_embedder_embed(emb, texts, lens, 3, &vecs);
    CHECK(st == CBERG_OK && vecs != NULL, "embed succeeds");
    if (st != CBERG_OK || vecs == NULL) {
        cberg_embedder_close(emb);
        return 1;
    }

    for (int i = 0; i < 3; i++) {
        float norm = sqrtf(dot(vecs + (size_t)i * dim, vecs + (size_t)i * dim, dim));
        CHECK(fabsf(norm - 1.0f) < 1e-3f, "vector is L2-normalized");
    }

    float sim_close = dot(vecs, vecs + dim, dim);
    float sim_far = dot(vecs, vecs + 2 * dim, dim);
    CHECK(sim_close > sim_far, "similar code is closer than dissimilar code");
    printf("cosine(close)=%.3f cosine(far)=%.3f\n", sim_close, sim_far);

    cberg_vectors_free(vecs);
    check_window_reaches_past_256_tokens(emb, dim);
    cberg_embedder_close(emb);

    if (failures == 0) {
        printf("ok - embed\n");
        return 0;
    }
    return 1;
}
