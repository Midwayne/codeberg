#include "index_provider_harness.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define DIM 4

static int failures;

#define CHECK(cond, msg)                                                                               \
    do {                                                                                               \
        if (!(cond)) {                                                                                 \
            fprintf(stderr, "FAIL [%s]: %s (%s:%d)\n", label, msg, __FILE__, __LINE__);                \
            failures++;                                                                                \
        }                                                                                              \
    } while (0)

static const char *label;

int index_provider_harness_run(const char *test_label, const cberg_index_config *cfg, const char *path) {
    label = test_label;
    failures = 0;

    float v10[DIM] = {1, 0, 0, 0};
    float v20[DIM] = {0, 1, 0, 0};
    float v30[DIM] = {0, 0, 1, 0};

    cberg_index *idx = NULL;
    cberg_status st = cberg_index_open(path, DIM, cfg, &idx);
    CHECK(st == CBERG_OK && idx != NULL, "index opens");
    if (idx == NULL) {
        return failures > 0 ? failures : 1;
    }

    CHECK(cberg_index_add(idx, 10, v10) == CBERG_OK, "add 10");
    CHECK(cberg_index_add(idx, 20, v20) == CBERG_OK, "add 20");
    CHECK(cberg_index_add(idx, 30, v30) == CBERG_OK, "add 30");

    uint64_t ids[3];
    float scores[3];
    size_t found = 0;
    float query[DIM] = {0.9f, 0.1f, 0.0f, 0.0f};
    st = cberg_index_search(idx, query, 2, NULL, ids, scores, &found);
    CHECK(st == CBERG_OK, "search ok");
    CHECK(found >= 1, "search found results");
    CHECK(found >= 1 && ids[0] == 10, "nearest to v10 is id 10");
    CHECK(found >= 2 && scores[0] >= scores[1], "scores descending");

    float v10b[DIM] = {0, 0, 0, 1};
    CHECK(cberg_index_add(idx, 10, v10b) == CBERG_OK, "replace 10");
    float query_w[DIM] = {0, 0, 0, 1};
    st = cberg_index_search(idx, query_w, 1, NULL, ids, scores, &found);
    CHECK(st == CBERG_OK && found >= 1 && ids[0] == 10, "replaced vector searchable");

    CHECK(cberg_index_remove(idx, 20) == CBERG_OK, "remove 20");
    CHECK(cberg_index_remove(idx, 20) == CBERG_ERR_NOT_FOUND, "remove absent -> NOT_FOUND");

    CHECK(cberg_index_save(idx) == CBERG_OK, "save");
    cberg_index_close(idx);
    idx = NULL;

    cberg_index *idx2 = NULL;
    st = cberg_index_open(path, DIM, cfg, &idx2);
    CHECK(st == CBERG_OK && idx2 != NULL, "reopen after save");
    if (idx2 != NULL) {
        st = cberg_index_search(idx2, v30, 1, NULL, ids, scores, &found);
        CHECK(st == CBERG_OK && found >= 1 && ids[0] == 30, "id 30 survived reopen");
        CHECK(cberg_index_clear(idx2) == CBERG_OK, "clear");
        st = cberg_index_search(idx2, v30, 1, NULL, ids, scores, &found);
        CHECK(st == CBERG_OK && found == 0, "clear removed vectors");
        cberg_index_close(idx2);
        idx2 = NULL;
    }

    CHECK(cberg_index_wipe(path, DIM, cfg) == CBERG_OK, "wipe");
    st = cberg_index_open(path, DIM, cfg, &idx);
    CHECK(st == CBERG_OK && idx != NULL, "reopen after wipe");
    if (idx != NULL) {
        CHECK(cberg_index_add(idx, 99, v10) == CBERG_OK, "add after wipe");
        st = cberg_index_search(idx, v10, 1, NULL, ids, scores, &found);
        CHECK(st == CBERG_OK && found >= 1 && ids[0] == 99, "search after wipe");
        cberg_index_close(idx);
    }

    if (cfg != NULL && cfg->provider == CBERG_INDEX_USEARCH) {
        remove(path);
    }

    return failures;
}
