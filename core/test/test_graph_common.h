#ifndef CODEBERG_TEST_GRAPH_COMMON_H
#define CODEBERG_TEST_GRAPH_COMMON_H

/*
 * Miniature indexing corpus for graph tests: chunker + chunk table + graph
 * wired the same way cberg-index wires them — analyze a source, sync the
 * accumulated chunk set, resolve fragment defs through the table, apply.
 */

#include <stdlib.h>
#include <string.h>

#include "codeberg/codeberg.h"

typedef struct graph_corpus {
    cberg_chunker *chunker;
    cberg_chunk_table *table;
    cberg_graph *graph;
    cberg_chunk *chunks; /* carried set across files (borrows list strings) */
    size_t chunks_len;
    size_t chunks_cap;
    cberg_chunk_list **lists; /* kept alive so carried chunks stay valid */
    size_t lists_len;
    size_t lists_cap;
} graph_corpus;

static cberg_status corpus_resolver(void *ctx, const char *key, uint64_t *out_id) {
    const cberg_stored_chunk *sc = cberg_chunk_table_find_by_key(ctx, key);
    if (sc == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    *out_id = sc->id;
    return CBERG_OK;
}

static int corpus_open(graph_corpus *c) {
    memset(c, 0, sizeof(*c));
    if (cberg_chunker_open(&c->chunker) != CBERG_OK) {
        return -1;
    }
    c->table = cberg_chunk_table_new();
    if (c->table == NULL || cberg_graph_new(&c->graph) != CBERG_OK) {
        return -1;
    }
    return 0;
}

static void corpus_close(graph_corpus *c) {
    for (size_t i = 0; i < c->lists_len; i++) {
        cberg_chunk_list_free(c->lists[i]);
    }
    free(c->lists);
    free(c->chunks);
    cberg_graph_free(c->graph);
    cberg_chunk_table_free(c->table);
    cberg_chunker_close(c->chunker);
}

static void corpus_drop_path(graph_corpus *c, const char *path) {
    size_t w = 0;
    for (size_t i = 0; i < c->chunks_len; i++) {
        if (strcmp(c->chunks[i].path, path) != 0) {
            c->chunks[w++] = c->chunks[i];
        }
    }
    c->chunks_len = w;
}

/* Index (or re-index) one source file into the corpus. */
static cberg_status corpus_index(graph_corpus *c, cberg_language lang, const char *path, const char *src) {
    cberg_chunk_list *list = NULL;
    cberg_graph_fragment *frag = NULL;
    size_t src_len = strlen(src);
    cberg_status st = cberg_chunker_analyze(c->chunker, lang, path, src, src_len, &list, &frag);
    if (st != CBERG_OK) {
        return st;
    }
    st = cberg_chunk_list_hash_bodies(list, src, src_len);
    if (st != CBERG_OK) {
        goto fail;
    }

    corpus_drop_path(c, path);
    size_t n = cberg_chunk_list_len(list);
    if (c->chunks_len + n > c->chunks_cap) {
        size_t cap = c->chunks_cap == 0 ? 64 : c->chunks_cap;
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
        st = cberg_graph_apply(c->graph, frag, corpus_resolver, c->table);
        if (st != CBERG_OK) {
            goto fail;
        }
    }
    cberg_graph_fragment_free(frag);

    if (c->lists_len + 1 > c->lists_cap) {
        size_t cap = c->lists_cap == 0 ? 8 : c->lists_cap * 2;
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

/* Delete one file from the corpus (chunk table and graph). */
static cberg_status corpus_remove(graph_corpus *c, const char *path) {
    corpus_drop_path(c, path);
    cberg_changes changes = {0};
    cberg_status st = cberg_chunk_table_sync(c->table, c->chunks, c->chunks_len, &changes);
    if (st != CBERG_OK) {
        return st;
    }
    return cberg_graph_remove_file(c->graph, path);
}

/* First live node with this exact name (and kind, unless kind_mask is 0). */
static const cberg_graph_node *corpus_node(graph_corpus *c, const char *name, uint32_t kind_mask) {
    const cberg_graph_node *nodes[8];
    size_t found = 0;
    if (cberg_graph_find_nodes(c->graph, name, kind_mask, NULL, nodes, 8, &found) != CBERG_OK || found == 0) {
        return NULL;
    }
    return nodes[0];
}

static const cberg_graph_edge *edges_find(const cberg_graph_edge *edges, size_t n, uint64_t src, uint64_t dst, cberg_graph_edge_kind kind) {
    for (size_t i = 0; i < n; i++) {
        if (edges[i].kind == kind && (src == 0 || edges[i].src == src) && (dst == 0 || edges[i].dst == dst)) {
            return &edges[i];
        }
    }
    return NULL;
}

#endif /* CODEBERG_TEST_GRAPH_COMMON_H */
