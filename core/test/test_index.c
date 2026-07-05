#define _POSIX_C_SOURCE 200809L

#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

#define DIM 4

int main(void) {
    char path[] = "/tmp/cberg_index_XXXXXX";
    int fd = mkstemp(path);
    if (fd >= 0) {
        close(fd);
        remove(path);
    }

    float v10[DIM] = {1, 0, 0, 0};
    float v20[DIM] = {0, 1, 0, 0};
    float v30[DIM] = {0, 0, 1, 0};

    cberg_index *idx = NULL;
    cberg_status st = cberg_index_open(path, DIM, NULL, &idx);
    CHECK(st == CBERG_OK && idx != NULL, "index opens");
    if (idx == NULL) {
        return 1;
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
    CHECK(found >= 2 && scores[0] >= scores[1], "scores are descending (best first)");

    float v10b[DIM] = {0, 0, 0, 1};
    CHECK(cberg_index_add(idx, 10, v10b) == CBERG_OK, "replace 10");
    float query_w[DIM] = {0, 0, 0, 1};
    st = cberg_index_search(idx, query_w, 1, NULL, ids, scores, &found);
    CHECK(st == CBERG_OK && found >= 1 && ids[0] == 10, "replaced vector found in new direction");

    CHECK(cberg_index_remove(idx, 20) == CBERG_OK, "remove 20");
    CHECK(cberg_index_remove(idx, 20) == CBERG_ERR_NOT_FOUND, "removing absent id -> NOT_FOUND");

    CHECK(cberg_index_compact(idx) == CBERG_OK, "compact");
    st = cberg_index_search(idx, query, 2, NULL, ids, scores, &found);
    CHECK(st == CBERG_OK && found >= 1, "search ok after compact");

    CHECK(cberg_index_save(idx) == CBERG_OK, "save");
    cberg_index_close(idx);

    cberg_index *idx2 = NULL;
    st = cberg_index_open(path, DIM, NULL, &idx2);
    CHECK(st == CBERG_OK && idx2 != NULL, "reopen loads saved index");
    if (idx2 != NULL) {
        st = cberg_index_search(idx2, v30, 1, NULL, ids, scores, &found);
        CHECK(st == CBERG_OK && found >= 1 && ids[0] == 30, "id 30 persisted across save/load");
        cberg_index_close(idx2);
    }
    remove(path);

    if (failures == 0) {
        printf("ok - index\n");
        return 0;
    }
    fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
}
