#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "../src/graph/import_cache.h"
#include "codeberg/codeberg.h"
#include "test_common.h"
#include "test_graph_common.h"

static void put(const char *root, const char *path, const char *source) {
    char absolute[4096];
    snprintf(absolute, sizeof absolute, "%s/%s", root, path);
    FILE *file = fopen(absolute, "w");
    CHECK(file != NULL, "open source");
    if (file != NULL) {
        fputs(source, file);
        fclose(file);
    }
}

static int calls_path(graph_corpus *corpus, const char *path) {
    const cberg_graph_node *caller = corpus_node(corpus, "run", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION));
    if (caller == NULL)
        return 0;

    cberg_graph_edge edges[16];
    size_t count = 0;
    CHECK(cberg_graph_edges_from(corpus->graph, caller->id, CBERG_GEDGE_CALLS, edges, 16, &count) == CBERG_OK, "query callers");
    if (count != 1)
        return 0;

    const cberg_graph_node *target = cberg_graph_node_by_id(corpus->graph, edges[0].dst);
    return target != NULL && strcmp(target->path, path) == 0;
}

static void test_changed_resolution(void) {
    char directory[] = "/tmp/cberg-scope-lifecycle-XXXXXX";
    char *root = mkdtemp(directory);
    CHECK(root != NULL, "temporary root");
    if (root == NULL)
        return;

    const char *utility = "export function save() {}\n";
    const char *caller = "import { save } from './util';\nexport function run() { save(); }\n";
    put(root, "util.ts", utility);
    put(root, "app.ts", caller);
    graph_corpus corpus;
    CHECK(corpus_open(&corpus) == 0, "open corpus");
    CHECK(corpus_index(&corpus, CBERG_LANG_TYPESCRIPT, "util.ts", utility) == CBERG_OK, "index target");
    CHECK(corpus_index(&corpus, CBERG_LANG_TYPESCRIPT, "app.ts", caller) == CBERG_OK, "index caller");

    cberg_import_cache *cache = NULL;
    CHECK(cberg_graph_resolve_cached(corpus.graph, root, &cache) == CBERG_OK, "resolve initial import");
    CHECK(calls_path(&corpus, "util.ts"), "initial target");

    char absolute[4096];
    snprintf(absolute, sizeof absolute, "%s/util.ts", root);
    CHECK(unlink(absolute) == 0, "delete old source");
    CHECK(corpus_remove(&corpus, "util.ts") == CBERG_OK, "remove old nodes");
    cberg_import_cache_note(&cache, "util.ts", 1);
    snprintf(absolute, sizeof absolute, "%s/util", root);
    CHECK(mkdir(absolute, 0700) == 0, "create replacement directory");
    put(root, "util/index.ts", utility);
    CHECK(corpus_index(&corpus, CBERG_LANG_TYPESCRIPT, "util/index.ts", utility) == CBERG_OK, "index replacement target");
    cberg_import_cache_note(&cache, "util/index.ts", 0);
    CHECK(cberg_graph_resolve_cached(corpus.graph, root, &cache) == CBERG_OK, "resolve replacement import");
    CHECK(calls_path(&corpus, "util/index.ts"), "unchanged importer follows a replacement source path");

    caller = "import { save as persist } from './util/index.js';\nexport function run() { persist(); }\n";
    CHECK(corpus_index(&corpus, CBERG_LANG_TYPESCRIPT, "app.ts", caller) == CBERG_OK, "reindex alias");
    CHECK(cberg_graph_resolve_cached(corpus.graph, root, &cache) == CBERG_OK, "resolve alias");
    CHECK(calls_path(&corpus, "util/index.ts"), "alias preserves caller after reindexing");

    cberg_import_cache_free(cache);
    corpus_close(&corpus);
    snprintf(absolute, sizeof absolute, "%s/util/index.ts", root);
    unlink(absolute);
    snprintf(absolute, sizeof absolute, "%s/util", root);
    rmdir(absolute);
    snprintf(absolute, sizeof absolute, "%s/app.ts", root);
    unlink(absolute);
    rmdir(root);
}

int main(void) {
    test_changed_resolution();
    TEST_MAIN_RETURN
}
