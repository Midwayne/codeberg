#include "codeberg/codeberg.h"

#include "../src/common/json_fields.h"
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

int main(void) {
    const char *manifest = "{\"private\":false,\"nested\":{\"name\":\"decoy\"},\"optional\":null,\"name\":\"@quality/storage\"}";
    char name[64];
    CHECK(cberg_json_string_copy(cberg_json_object_field(manifest, "name"), name, sizeof name) == 0, "read manifest name after literals and nested objects");
    CHECK(strcmp(name, "@quality/storage") == 0, "nested names cannot identify a provider");
    CHECK(cberg_json_string_copy("\"escaped\\nname\"", name, sizeof name) != 0, "unsupported escaped paths remain unresolved");
    CHECK(cberg_json_object_field("{\"nested\":{\"x\":\"\\", "name") == NULL, "truncated escape is rejected safely");
    test_collection_dim();
    test_search_hits();
    if (failures == 0) {
        printf("ok - qdrant json\n");
        return 0;
    }
    fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
}
