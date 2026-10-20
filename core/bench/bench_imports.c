#include "bench.h"
#include "codeberg/codeberg.h"
#include "../test/test_graph_common.h"
#include "../src/graph/import_cache.h"

#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

/* Isolate package-map work: a tree of 5000 source files and an unresolved
 * external relative import. Repeated resolution must retain that import. */
int main(void) {
    char root[] = "/tmp/cberg-import-bench-XXXXXX";
    if (mkdtemp(root) == NULL) return 1;

    char path[512];
    for (size_t i = 0; i < 5000; i++) {
        snprintf(path, sizeof(path), "%s/f%zu.ts", root, i);
        FILE *file = fopen(path, "w");
        if (file == NULL) return 1;
        fputs("export function f() {}\n", file);
        fclose(file);
    }
    graph_corpus corpus;
    if (corpus_open(&corpus) != 0 ||
        corpus_index(&corpus, CBERG_LANG_TYPESCRIPT, "f0.ts", "import './missing';\n") != CBERG_OK) return 1;

#ifndef CBERG_BENCH_PARENT
    cberg_import_cache *cache = NULL;
    if (cberg_graph_resolve_cached(corpus.graph, root, &cache) != CBERG_OK) return 1;
#endif

    cberg_bench_timer timer;
    cberg_bench_start(&timer);
    for (int i = 0; i < 20; i++) {
#ifdef CBERG_BENCH_PARENT
        if (cberg_graph_resolve_imports(corpus.graph, root) != CBERG_OK) return 1;
#else
        if (cberg_graph_resolve_cached(corpus.graph, root, &cache) != CBERG_OK) return 1;
#endif
    }
    cberg_bench_stop(&timer);
    cberg_bench_report("20 import passes, 5000 files", &timer, 20);

#ifndef CBERG_BENCH_PARENT
    cberg_import_cache_free(cache);
#endif
    corpus_close(&corpus);
    for (size_t i = 0; i < 5000; i++) {
        snprintf(path, sizeof(path), "%s/f%zu.ts", root, i);
        unlink(path);
    }
    rmdir(root);
    return 0;
}
