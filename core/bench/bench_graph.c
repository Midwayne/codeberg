#include "bench.h"
#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/*
 * Synthetic corpus sized like a mid-size package tree: N files, each with a
 * handful of functions that call a shared hub name plus a unique neighbor.
 * Exercises apply/remove churn, name-resolution edges_to, BFS trace, and
 * save/load throughput against the RAM-first graph store.
 */

static char *make_src(size_t file_i, size_t funcs_per_file) {
    size_t cap = 256 + funcs_per_file * 96;
    char *buf = malloc(cap);
    if (buf == NULL) {
        return NULL;
    }
    size_t off = (size_t)snprintf(buf, cap, "package p%zu\n\n", file_i);
    for (size_t f = 0; f < funcs_per_file; f++) {
        int n = snprintf(buf + off, cap - off,
                         "func F%zu_%zu() {\n\thub()\n\tN%zu_%zu()\n}\n"
                         "func N%zu_%zu() {}\n",
                         file_i, f, file_i, f, file_i, f);
        if (n < 0 || (size_t)n >= cap - off) {
            free(buf);
            return NULL;
        }
        off += (size_t)n;
    }
    if (file_i == 0) {
        int n = snprintf(buf + off, cap - off, "func hub() {}\n");
        if (n < 0 || (size_t)n >= cap - off) {
            free(buf);
            return NULL;
        }
    }
    return buf;
}

typedef struct {
    cberg_chunker *chunker;
    cberg_chunk_table *table;
    cberg_graph *graph;
    cberg_chunk *chunks;
    size_t chunks_len;
    size_t chunks_cap;
    cberg_chunk_list **lists;
    size_t lists_len;
    size_t lists_cap;
    char **srcs;
    size_t srcs_len;
} bench_corpus;

static cberg_status resolve_key(void *ctx, const char *key, uint64_t *out_id) {
    const cberg_stored_chunk *sc = cberg_chunk_table_find_by_key(ctx, key);
    if (sc == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    *out_id = sc->id;
    return CBERG_OK;
}

static void corpus_free(bench_corpus *c) {
    if (c == NULL) {
        return;
    }
    for (size_t i = 0; i < c->lists_len; i++) {
        cberg_chunk_list_free(c->lists[i]);
    }
    free(c->lists);
    free(c->chunks);
    for (size_t i = 0; i < c->srcs_len; i++) {
        free(c->srcs[i]);
    }
    free(c->srcs);
    cberg_graph_free(c->graph);
    cberg_chunk_table_free(c->table);
    cberg_chunker_close(c->chunker);
    memset(c, 0, sizeof(*c));
}

static int corpus_open(bench_corpus *c) {
    memset(c, 0, sizeof(*c));
    if (cberg_chunker_open(&c->chunker) != CBERG_OK) {
        return -1;
    }
    c->table = cberg_chunk_table_new();
    if (c->table == NULL || cberg_graph_new(&c->graph) != CBERG_OK) {
        corpus_free(c);
        return -1;
    }
    return 0;
}

static void drop_path(bench_corpus *c, const char *path) {
    size_t w = 0;
    for (size_t i = 0; i < c->chunks_len; i++) {
        if (strcmp(c->chunks[i].path, path) != 0) {
            c->chunks[w++] = c->chunks[i];
        }
    }
    c->chunks_len = w;
}

static cberg_status index_file(bench_corpus *c, const char *path, const char *src) {
    cberg_chunk_list *list = NULL;
    cberg_graph_fragment *frag = NULL;
    size_t src_len = strlen(src);
    cberg_status st = cberg_chunker_analyze(c->chunker, CBERG_LANG_GO, path, src, src_len, &list, &frag);
    if (st != CBERG_OK) {
        return st;
    }
    st = cberg_chunk_list_hash_bodies(list, src, src_len);
    if (st != CBERG_OK) {
        goto fail;
    }

    drop_path(c, path);
    size_t n = cberg_chunk_list_len(list);
    if (c->chunks_len + n > c->chunks_cap) {
        size_t cap = c->chunks_cap == 0 ? 256 : c->chunks_cap;
        while (cap < c->chunks_len + n) {
            cap *= 2;
        }
        cberg_chunk *grown = realloc(c->chunks, cap * sizeof(*grown));
        if (grown == NULL) {
            st = CBERG_ERR_OUT_OF_MEMORY;
            goto fail;
        }
        c->chunks = grown;
        c->chunks_cap = cap;
    }
    for (size_t i = 0; i < n; i++) {
        c->chunks[c->chunks_len++] = *cberg_chunk_list_at(list, i);
    }

    cberg_changes changes = {0};
    st = cberg_chunk_table_sync(c->table, c->chunks, c->chunks_len, &changes);
    if (st != CBERG_OK) {
        goto fail;
    }
    if (frag != NULL) {
        st = cberg_graph_apply(c->graph, frag, resolve_key, c->table);
        if (st != CBERG_OK) {
            goto fail;
        }
    }
    cberg_graph_fragment_free(frag);

    if (c->lists_len + 1 > c->lists_cap) {
        size_t cap = c->lists_cap == 0 ? 64 : c->lists_cap * 2;
        cberg_chunk_list **grown = realloc(c->lists, cap * sizeof(*grown));
        if (grown == NULL) {
            cberg_chunk_list_free(list);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        c->lists = grown;
        c->lists_cap = cap;
    }
    c->lists[c->lists_len++] = list;
    return CBERG_OK;

fail:
    cberg_graph_fragment_free(frag);
    cberg_chunk_list_free(list);
    return st;
}

static int build_corpus(bench_corpus *c, size_t n_files, size_t funcs_per_file) {
    c->srcs = calloc(n_files, sizeof(char *));
    if (c->srcs == NULL) {
        return -1;
    }
    c->srcs_len = n_files;
    for (size_t i = 0; i < n_files; i++) {
        c->srcs[i] = make_src(i, funcs_per_file);
        if (c->srcs[i] == NULL) {
            return -1;
        }
        char path[64];
        snprintf(path, sizeof path, "pkg/f%zu.go", i);
        if (index_file(c, path, c->srcs[i]) != CBERG_OK) {
            return -1;
        }
    }
    return 0;
}

int main(void) {
    const size_t n_files = 200;
    const size_t funcs_per_file = 4;
    const size_t churn_rounds = 50;
    const size_t query_rounds = 200;
    const size_t trace_rounds = 100;

    bench_corpus corpus;
    if (corpus_open(&corpus) != 0) {
        fprintf(stderr, "corpus_open failed\n");
        return 1;
    }

    cberg_bench_timer t;
    cberg_bench_start(&t);
    if (build_corpus(&corpus, n_files, funcs_per_file) != 0) {
        fprintf(stderr, "build_corpus failed\n");
        corpus_free(&corpus);
        return 1;
    }
    cberg_bench_stop(&t);
    cberg_bench_report("graph cold apply", &t, n_files);

    size_t nodes = 0;
    size_t refs = 0;
    cberg_graph_counts(corpus.graph, &nodes, &refs);
    if (nodes == 0 || refs == 0) {
        fprintf(stderr, "empty graph after build (nodes=%zu refs=%zu)\n", nodes, refs);
        corpus_free(&corpus);
        return 1;
    }

    /* Apply/remove churn on the last file. */
    const char *churn_path = "pkg/f199.go";
    cberg_bench_start(&t);
    for (size_t r = 0; r < churn_rounds; r++) {
        if (cberg_graph_remove_file(corpus.graph, churn_path) != CBERG_OK) {
            fprintf(stderr, "remove_file failed\n");
            corpus_free(&corpus);
            return 1;
        }
        if (index_file(&corpus, churn_path, corpus.srcs[n_files - 1]) != CBERG_OK) {
            fprintf(stderr, "re-apply failed\n");
            corpus_free(&corpus);
            return 1;
        }
    }
    cberg_bench_stop(&t);
    cberg_bench_report("graph apply/remove churn", &t, churn_rounds);

    const cberg_graph_node *hub_nodes[8];
    size_t hub_n = 0;
    if (cberg_graph_find_nodes(corpus.graph, "hub", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION), NULL, hub_nodes, 8, &hub_n) != CBERG_OK ||
        hub_n == 0) {
        fprintf(stderr, "hub node missing\n");
        corpus_free(&corpus);
        return 1;
    }
    uint64_t hub_id = hub_nodes[0]->id;

    cberg_graph_edge edges[64];
    size_t edge_n = 0;
    cberg_bench_start(&t);
    size_t edge_hits = 0;
    for (size_t r = 0; r < query_rounds; r++) {
        if (cberg_graph_edges_to(corpus.graph, hub_id, CBERG_GEDGE_CALLS, edges, 64, &edge_n) != CBERG_OK) {
            fprintf(stderr, "edges_to failed\n");
            corpus_free(&corpus);
            return 1;
        }
        edge_hits += edge_n;
    }
    cberg_bench_stop(&t);
    cberg_bench_report("graph edges_to hub", &t, query_rounds);
    if (edge_hits == 0) {
        fprintf(stderr, "hub has no callers\n");
        corpus_free(&corpus);
        return 1;
    }

    cberg_graph_hop hops[256];
    size_t hop_n = 0;
    cberg_bench_start(&t);
    size_t hop_hits = 0;
    for (size_t r = 0; r < trace_rounds; r++) {
        if (cberg_graph_trace(corpus.graph, hub_id, CBERG_GRAPH_IN, CBERG_GEDGE_CALLS, 2, hops, 256, &hop_n) != CBERG_OK) {
            fprintf(stderr, "trace failed\n");
            corpus_free(&corpus);
            return 1;
        }
        hop_hits += hop_n;
    }
    cberg_bench_stop(&t);
    cberg_bench_report("graph BFS trace in", &t, trace_rounds);
    if (hop_hits == 0) {
        fprintf(stderr, "trace returned no hops\n");
        corpus_free(&corpus);
        return 1;
    }

    const size_t hubs_rounds = 50;
    cberg_graph_hub hubs[32];
    size_t hubs_n = 0;
    cberg_bench_start(&t);
    size_t hubs_hits = 0;
    for (size_t r = 0; r < hubs_rounds; r++) {
        if (cberg_graph_hubs(corpus.graph, hubs, 32, &hubs_n) != CBERG_OK) {
            fprintf(stderr, "hubs failed\n");
            corpus_free(&corpus);
            return 1;
        }
        hubs_hits += hubs_n;
    }
    cberg_bench_stop(&t);
    cberg_bench_report("graph hubs top32", &t, hubs_rounds);
    if (hubs_hits == 0) {
        fprintf(stderr, "hubs returned empty\n");
        corpus_free(&corpus);
        return 1;
    }

    char path[] = "/tmp/cberg-bench-graph-XXXXXX";
    int fd = mkstemp(path);
    if (fd < 0) {
        fprintf(stderr, "mkstemp failed\n");
        corpus_free(&corpus);
        return 1;
    }
    close(fd);
    unlink(path);

    cberg_bench_start(&t);
    if (cberg_graph_save(corpus.graph, path) != CBERG_OK) {
        fprintf(stderr, "save failed\n");
        corpus_free(&corpus);
        return 1;
    }
    cberg_bench_stop(&t);
    cberg_bench_report("graph save", &t, nodes + refs);

    cberg_graph *loaded = NULL;
    cberg_bench_start(&t);
    if (cberg_graph_load(path, &loaded) != CBERG_OK || loaded == NULL) {
        fprintf(stderr, "load failed\n");
        unlink(path);
        corpus_free(&corpus);
        return 1;
    }
    cberg_bench_stop(&t);
    cberg_bench_report("graph load", &t, nodes + refs);

    size_t loaded_nodes = 0;
    size_t loaded_refs = 0;
    cberg_graph_counts(loaded, &loaded_nodes, &loaded_refs);
    if (loaded_nodes != nodes || loaded_refs != refs) {
        fprintf(stderr, "load counts mismatch nodes %zu/%zu refs %zu/%zu\n", loaded_nodes, nodes, loaded_refs, refs);
        cberg_graph_free(loaded);
        unlink(path);
        corpus_free(&corpus);
        return 1;
    }

    cberg_graph_free(loaded);
    unlink(path);
    corpus_free(&corpus);
    return 0;
}
