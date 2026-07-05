#include "codeberg/codeberg.h"

#include "json_mini.h"

#include <stdio.h>
#include <string.h>

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

static void test_collection_dim(void) {
    static const char body[] =
        "{\"result\":{\"config\":{\"params\":{\"vectors\":{\"size\":768,\"distance\":\"Cosine\"}}}}}";
    int dim = 0;
    CHECK(cberg_json_qdrant_collection_dim(body, &dim) == 0, "parse collection dim");
    CHECK(dim == 768, "collection dim value");
}

static void test_search_hits(void) {
    static const char body[] = "{\"result\":[{\"id\":10,\"score\":0.95},{\"id\":20,\"score\":0.5}]}";
    uint64_t ids[2];
    float scores[2];
    size_t found = 0;
    CHECK(cberg_json_parse_qdrant_hits(body, 2, ids, scores, &found) == 0, "parse hits");
    CHECK(found == 2, "hit count");
    CHECK(ids[0] == 10 && ids[1] == 20, "hit ids");
    CHECK(scores[0] > scores[1], "hit scores");
}

static void test_points_nonempty(void) {
    static const char empty[] = "{\"result\":[]}";
    static const char nonempty[] = "{\"result\":[{\"id\":1}]}";
    CHECK(cberg_json_qdrant_points_nonempty(empty) == 0, "empty points");
    CHECK(cberg_json_qdrant_points_nonempty(nonempty) == 1, "nonempty points");
}

int main(void) {
    test_collection_dim();
    test_search_hits();
    test_points_nonempty();
    if (failures == 0) {
        printf("ok - qdrant json\n");
        return 0;
    }
    fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
}
