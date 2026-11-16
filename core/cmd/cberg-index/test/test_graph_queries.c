/* Single-repository graph queries: a path filter matches whole path
 * components, so "util.ts" selects util.ts and never util.tsx, even though
 * both define a same-name symbol. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "../../../test/test_common.h"
#include "indexer.h"

static void put(const char *root, const char *file, const char *body) {
    char path[4096];
    snprintf(path, sizeof path, "%s/%s", root, file);

    FILE *stream = fopen(path, "w");
    CHECK(stream != NULL, "open fixture source");
    if (stream != NULL) {
        fputs(body, stream);
        fclose(stream);
    }
}

static void remove_fixture(const char *root) {
    const char *files[] = {"util.ts", "util.tsx"};
    char path[4096];

    for (size_t i = 0; i < sizeof files / sizeof files[0]; i++) {
        snprintf(path, sizeof path, "%s/%s", root, files[i]);
        remove(path);
    }
    rmdir(root);
}

static void check_references_match_whole_path(cberg_engine *engine) {
    cberg_engine_graph_edge refs[16];
    size_t count = 0;

    cberg_status status = cberg_engine_graph_references(engine, "helper", NULL, "util.ts", 16, refs, 16, &count);
    CHECK(status == CBERG_OK, "references with a path filter succeed");
    CHECK(count == 1, "util.ts does not also select util.tsx");
    if (count == 1) {
        CHECK(strcmp(refs[0].src_name, "use_ts") == 0, "the caller is the one in util.ts");
    }

    status = cberg_engine_graph_references(engine, "helper", NULL, NULL, 16, refs, 16, &count);
    CHECK(status == CBERG_OK && count == 2, "without a path filter both definitions' callers are returned");
}

static void check_trace_matches_whole_path(cberg_engine *engine) {
    cberg_engine_graph_hop hops[16];
    size_t count = 0;

    cberg_status status = cberg_engine_trace_path(engine, "helper", 0, NULL, "util.tsx", "in", "calls", 1, 16, hops, 16, &count);
    CHECK(status == CBERG_OK, "trace with a path filter succeeds");
    CHECK(count == 1, "trace starts from one definition");
    if (count == 1) {
        CHECK(strcmp(hops[0].edge.src_name, "use_tsx") == 0, "trace starts from the util.tsx definition");
    }
}

int main(void) {
    char tmpl[] = "/tmp/cberg-graph-queries-XXXXXX";
    char *root = mkdtemp(tmpl);
    CHECK(root != NULL, "temporary repository");
    if (root == NULL) {
        return 1;
    }

    put(root, "util.ts", "export function helper() {}\nexport function use_ts() { helper(); }\n");
    put(root, "util.tsx", "export function helper() {}\nexport function use_tsx() { helper(); }\n");

    char roots[4200];
    snprintf(roots, sizeof roots, "solo\t%s\n", root);
    unsetenv("CBERG_MODEL");
    unsetenv("CBERG_INDEX_PATH");
    setenv("CODEBERG_ROOTS", roots, 1);

    cberg_engine engine;
    cberg_status status = cberg_engine_open(&engine);
    CHECK(status == CBERG_OK && engine.repos_len == 1, "open single-repo chunk-only engine");

    if (status == CBERG_OK) {
        CHECK(cberg_repo_bootstrap(engine.repos[0]) == CBERG_OK, "bootstrap repository");
        check_references_match_whole_path(&engine);
        check_trace_matches_whole_path(&engine);
        cberg_engine_close(&engine);
    }

    remove_fixture(root);
    TEST_MAIN_RETURN
}
