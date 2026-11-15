#include "bench.h"
#include "codeberg/codeberg.h"
#include "fileio.h"

#include <stdio.h>
#include <stdlib.h>

/*
 * Per-file analyze cost on real sources: chunking alone versus chunking plus
 * graph extraction (definitions, references and lexical call binding).
 *
 *   bench_extract FILE...
 *
 * Large generated files (parsers, bundles) are the interesting inputs: binding
 * cost must stay near-linear in file size or one file stalls a cold index.
 */

static int analyze(cberg_chunker *chunker, cberg_language lang, const char *path, const char *src, size_t len, int graph, double *out_ms, size_t *out_chunks) {
    cberg_chunk_list *list = NULL;
    cberg_graph_fragment *fragment = NULL;
    cberg_bench_timer timer;

    cberg_bench_start(&timer);
    cberg_status st = cberg_chunker_analyze(chunker, lang, path, src, len, &list, graph ? &fragment : NULL);
    cberg_bench_stop(&timer);

    if (st != CBERG_OK) {
        fprintf(stderr, "%s: %s\n", path, cberg_status_str(st));
        return -1;
    }

    *out_ms = cberg_bench_seconds(&timer) * 1e3;
    *out_chunks = cberg_chunk_list_len(list);

    cberg_graph_fragment_free(fragment);
    cberg_chunk_list_free(list);
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: bench_extract FILE...\n");
        return 1;
    }

    cberg_chunker *chunker = NULL;
    if (cberg_chunker_open(&chunker) != CBERG_OK) {
        fprintf(stderr, "chunker open failed\n");
        return 1;
    }

    printf("%-48s %10s %8s %12s %12s\n", "file", "bytes", "chunks", "chunk ms", "+graph ms");

    for (int i = 1; i < argc; i++) {
        size_t len = 0;
        char *src = cberg_read_file(argv[i], &len);
        cberg_language lang = cberg_language_from_path(argv[i]);
        if (src == NULL || lang == CBERG_LANG_UNKNOWN) {
            fprintf(stderr, "%s: unreadable or unknown language\n", argv[i]);
            free(src);
            continue;
        }

        double chunk_ms = 0, graph_ms = 0;
        size_t chunks = 0;
        if (analyze(chunker, lang, argv[i], src, len, 0, &chunk_ms, &chunks) == 0 &&
            analyze(chunker, lang, argv[i], src, len, 1, &graph_ms, &chunks) == 0) {
            printf("%-48.48s %10zu %8zu %12.1f %12.1f\n", argv[i], len, chunks, chunk_ms, graph_ms);
        }

        free(src);
    }

    cberg_chunker_close(chunker);
    return 0;
}
