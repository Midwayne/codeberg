#include "index_provider_harness.h"
#include "test_common.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static const char *label;

static float *unit_vector(size_t dim, size_t axis) {
    float *v = calloc(dim, sizeof(float));
    if (v != NULL && axis < dim) {
        v[axis] = 1.0f;
    }
    return v;
}

int index_provider_test_usearch_expansion_restore(void) {
    const char *label = "usearch-expansion";
    int local_failures = 0;
#define ECHECK(cond, msg)                                                               \
    do {                                                                                \
        if (!(cond)) {                                                                  \
            fprintf(stderr, "FAIL [%s]: %s (%s:%d)\n", label, msg, __FILE__, __LINE__); \
            local_failures++;                                                           \
        }                                                                               \
    } while (0)

    char path[] = "/tmp/cberg_expansion_XXXXXX";
    int fd = mkstemp(path);
    if (fd >= 0) {
        close(fd);
        remove(path);
    }

    cberg_index_config cfg;
    cberg_index_config_default(&cfg);
    cfg.expansion_search = 64;

    cberg_index *idx = NULL;
    ECHECK(cberg_index_open(path, 4, &cfg, &idx) == CBERG_OK && idx != NULL, "open");

    if (idx != NULL) {
        float v[4] = {1, 0, 0, 0};
        ECHECK(cberg_index_add(idx, 1, v) == CBERG_OK, "add");
        cberg_index_search_opts high = {.expansion_search = 256};
        uint64_t ids[1];
        float scores[1];
        size_t found = 0;
        ECHECK(cberg_index_search(idx, v, 1, &high, ids, scores, &found) == CBERG_OK, "high-ef search");
        size_t ef = 0;
        ECHECK(cberg_usearch_index_active_expansion(idx, &ef) == CBERG_OK, "read ef");
        ECHECK(ef == cfg.expansion_search, "expansion_search restored after query");
        cberg_index_close(idx);
    }

    remove(path);
    return local_failures;
#undef ECHECK
}

int index_provider_harness_run(const char *test_label, const cberg_index_config *cfg, const char *path, size_t dim) {
    label = test_label;
    failures = 0;

    if (dim == 0) {
        fprintf(stderr, "FAIL [%s]: dim must be > 0\n", label);
        return 1;
    }

    float *v10 = unit_vector(dim, 0);
    float *v20 = unit_vector(dim, dim > 1 ? 1 : 0);
    float *v30 = unit_vector(dim, dim > 2 ? 2 : 0);
    if (v10 == NULL || v20 == NULL || v30 == NULL) {
        free(v10);
        free(v20);
        free(v30);
        fprintf(stderr, "FAIL [%s]: out of memory for test vectors\n", label);
        return 1;
    }

    cberg_index *idx = NULL;
    cberg_status st = cberg_index_open(path, dim, cfg, &idx);
    TEST_CHECK_LABELED(label, st == CBERG_OK && idx != NULL, "index opens");
    if (idx == NULL) {
        free(v10);
        free(v20);
        free(v30);
        return failures > 0 ? failures : 1;
    }

    TEST_CHECK_LABELED(label, cberg_index_add(idx, 10, v10) == CBERG_OK, "add 10");
    TEST_CHECK_LABELED(label, cberg_index_add(idx, 20, v20) == CBERG_OK, "add 20");
    TEST_CHECK_LABELED(label, cberg_index_add(idx, 30, v30) == CBERG_OK, "add 30");

    uint64_t *ids = calloc(dim > 3 ? dim : 3, sizeof(uint64_t));
    float *scores = calloc(dim > 3 ? dim : 3, sizeof(float));
    float *query = calloc(dim, sizeof(float));
    if (ids == NULL || scores == NULL || query == NULL) {
        cberg_index_close(idx);
        free(v10);
        free(v20);
        free(v30);
        free(ids);
        free(scores);
        free(query);
        return failures > 0 ? failures : 1;
    }
    if (dim > 0) {
        query[0] = 0.9f;
    }
    if (dim > 1) {
        query[1] = 0.1f;
    }

    size_t found = 0;
    st = cberg_index_search(idx, query, 2, NULL, ids, scores, &found);
    TEST_CHECK_LABELED(label, st == CBERG_OK, "search ok");
    TEST_CHECK_LABELED(label, found >= 1, "search found results");
    TEST_CHECK_LABELED(label, found >= 1 && ids[0] == 10, "nearest to v10 is id 10");
    TEST_CHECK_LABELED(label, found >= 2 && scores[0] >= scores[1], "scores descending");

    float *v10b = unit_vector(dim, dim - 1);
    if (v10b != NULL) {
        TEST_CHECK_LABELED(label, cberg_index_add(idx, 10, v10b) == CBERG_OK, "replace 10");
        st = cberg_index_search(idx, v10b, 1, NULL, ids, scores, &found);
        TEST_CHECK_LABELED(label, st == CBERG_OK && found >= 1 && ids[0] == 10, "replaced vector searchable");
        free(v10b);
    } else {
        TEST_CHECK_LABELED(label, 0, "replace vector alloc");
    }

    TEST_CHECK_LABELED(label, cberg_index_remove(idx, 20) == CBERG_OK, "remove 20");
    st = cberg_index_remove(idx, 20);
    TEST_CHECK_LABELED(label, st == CBERG_ERR_NOT_FOUND || st == CBERG_OK, "remove absent is idempotent");

    TEST_CHECK_LABELED(label, cberg_index_save(idx) == CBERG_OK, "save");
    cberg_index_close(idx);
    idx = NULL;

    cberg_index *idx2 = NULL;
    st = cberg_index_open(path, dim, cfg, &idx2);
    TEST_CHECK_LABELED(label, st == CBERG_OK && idx2 != NULL, "reopen after save");
    if (idx2 != NULL) {
        st = cberg_index_search(idx2, v30, 1, NULL, ids, scores, &found);
        TEST_CHECK_LABELED(label, st == CBERG_OK && found >= 1 && ids[0] == 30, "id 30 survived reopen");
        TEST_CHECK_LABELED(label, cberg_index_clear(idx2) == CBERG_OK, "clear");
        st = cberg_index_search(idx2, v30, 1, NULL, ids, scores, &found);
        TEST_CHECK_LABELED(label, st == CBERG_OK && found == 0, "clear removed vectors");
        cberg_index_close(idx2);
        idx2 = NULL;
    }

    TEST_CHECK_LABELED(label, cberg_index_wipe(path, dim, cfg) == CBERG_OK, "wipe");
    st = cberg_index_open(path, dim, cfg, &idx);
    TEST_CHECK_LABELED(label, st == CBERG_OK && idx != NULL, "reopen after wipe");
    if (idx != NULL) {
        TEST_CHECK_LABELED(label, cberg_index_add(idx, 99, v10) == CBERG_OK, "add after wipe");
        st = cberg_index_search(idx, v10, 1, NULL, ids, scores, &found);
        TEST_CHECK_LABELED(label, st == CBERG_OK && found >= 1 && ids[0] == 99, "search after wipe");
        cberg_index_close(idx);
    }

    if (cfg != NULL && cfg->provider == CBERG_INDEX_USEARCH) {
        remove(path);
    }

    free(v10);
    free(v20);
    free(v30);
    free(ids);
    free(scores);
    free(query);

    return failures;
}
