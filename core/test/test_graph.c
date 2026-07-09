/*
 * Graph store: end-to-end apply/query/trace over a small Go corpus, incremental
 * replace and delete, textual-resolution confidence, persistence round-trip.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "codeberg/codeberg.h"
#include "test_common.h"
#include "test_graph_common.h"

static const char *const A_GO =
    "package main\n"
    "\n"
    "import \"fmt\"\n"
    "\n"
    "type Server struct{}\n"
    "\n"
    "func (s *Server) Start() {\n"
    "\thelper()\n"
    "}\n"
    "\n"
    "func helper() {\n"
    "\tfmt.Println(\"x\")\n"
    "}\n";

static const char *const B_GO =
    "package main\n"
    "\n"
    "func run() {\n"
    "\thelper()\n"
    "\tother()\n"
    "}\n"
    "\n"
    "func other() {}\n";

/* b.go rewritten so run no longer calls helper. */
static const char *const B_GO_V2 =
    "package main\n"
    "\n"
    "func run() {\n"
    "\tother()\n"
    "}\n"
    "\n"
    "func other() {}\n";

static void test_build_and_query(graph_corpus *c) {
    CHECK(corpus_index(c, CBERG_LANG_GO, "a.go", A_GO) == CBERG_OK, "index a.go");
    CHECK(corpus_index(c, CBERG_LANG_GO, "b.go", B_GO) == CBERG_OK, "index b.go");

    size_t nodes = 0;
    size_t refs = 0;
    cberg_graph_counts(c->graph, &nodes, &refs);
    /* 2 files + Server/Start/helper + run/other + module fmt = 8 nodes. */
    CHECK(nodes == 8, "corpus has 8 nodes");
    CHECK(refs > 0, "corpus has reference records");

    const cberg_graph_node *helper = corpus_node(c, "helper", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION));
    const cberg_graph_node *server = corpus_node(c, "Server", CBERG_GNODE_MASK(CBERG_GNODE_STRUCT));
    const cberg_graph_node *start = corpus_node(c, "Start", CBERG_GNODE_MASK(CBERG_GNODE_METHOD));
    const cberg_graph_node *run = corpus_node(c, "run", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION));
    const cberg_graph_node *file_a = corpus_node(c, "a.go", CBERG_GNODE_MASK(CBERG_GNODE_FILE));
    const cberg_graph_node *fmt_mod = corpus_node(c, "fmt", CBERG_GNODE_MASK(CBERG_GNODE_MODULE));
    CHECK(helper != NULL && server != NULL && start != NULL && run != NULL, "symbol nodes exist");
    CHECK(file_a != NULL, "file node exists");
    CHECK(fmt_mod != NULL, "import created a module node");
    if (helper == NULL || server == NULL || start == NULL || run == NULL || file_a == NULL || fmt_mod == NULL) {
        return;
    }
    CHECK(strcmp(file_a->qname, "a.go") == 0, "file qname is the path");
    CHECK(strcmp(helper->path, "a.go") == 0, "helper defined in a.go");
    CHECK(helper->id != 0 && (helper->id >> 63) == 0, "symbol node reuses a chunk id");
    CHECK((file_a->id >> 63) == 1, "file node id is synthetic");
    CHECK(cberg_graph_node_by_id(c->graph, helper->id) == helper, "node_by_id round-trips");
    CHECK(cberg_graph_node_by_id(c->graph, 0xDEAD) == NULL, "unknown id yields NULL");

    /* Callers of helper: Start (same file, 0.90) and run (cross file, 0.75). */
    cberg_graph_edge edges[16];
    size_t n = 0;
    CHECK(cberg_graph_edges_to(c->graph, helper->id, CBERG_GEDGE_CALLS, edges, 16, &n) == CBERG_OK, "edges_to helper");
    CHECK(n == 2, "helper has two callers");
    const cberg_graph_edge *from_start = edges_find(edges, n, start->id, helper->id, CBERG_GEDGE_CALLS);
    const cberg_graph_edge *from_run = edges_find(edges, n, run->id, helper->id, CBERG_GEDGE_CALLS);
    CHECK(from_start != NULL, "Start calls helper");
    CHECK(from_run != NULL, "run calls helper");
    if (from_start != NULL && from_run != NULL) {
        CHECK(from_start->confidence > 0.89f && from_start->confidence < 0.91f, "same-file call scores 0.90");
        CHECK(from_run->confidence > 0.74f && from_run->confidence < 0.76f, "unique cross-file call scores 0.75");
        CHECK(from_start->resolution == CBERG_GRES_TEXTUAL, "phase 1 edges are textual");
        CHECK(from_start->line == 8, "call site line recorded");
    }

    /* helper's own callees: fmt.Println is not indexed, so nothing resolves. */
    CHECK(cberg_graph_edges_from(c->graph, helper->id, CBERG_GEDGE_CALLS, edges, 16, &n) == CBERG_OK, "edges_from helper");
    CHECK(n == 0, "unindexed callee yields no edge");

    /* Receiver membership: Server -CONTAINS-> Start (reversed ref). */
    CHECK(cberg_graph_edges_from(c->graph, server->id, CBERG_GEDGE_CONTAINS, edges, 16, &n) == CBERG_OK, "edges_from Server");
    CHECK(n == 1 && edges[0].dst == start->id, "Server contains Start");
    CHECK(cberg_graph_edges_to(c->graph, start->id, CBERG_GEDGE_CONTAINS, edges, 16, &n) == CBERG_OK, "edges_to Start");
    CHECK(n == 1 && edges[0].src == server->id, "Start contained by Server");

    /* DEFINES is synthesized both ways. */
    CHECK(cberg_graph_edges_from(c->graph, file_a->id, CBERG_GEDGE_DEFINES, edges, 16, &n) == CBERG_OK, "file defines");
    CHECK(n == 3, "a.go defines three symbols");
    CHECK(cberg_graph_edges_to(c->graph, helper->id, CBERG_GEDGE_DEFINES, edges, 16, &n) == CBERG_OK, "defined-by");
    CHECK(n == 1 && edges[0].src == file_a->id, "helper defined by a.go");

    /* Imports land on module nodes with full confidence. */
    CHECK(cberg_graph_edges_from(c->graph, file_a->id, CBERG_GEDGE_IMPORTS, edges, 16, &n) == CBERG_OK, "file imports");
    CHECK(n == 1 && edges[0].dst == fmt_mod->id, "a.go imports fmt");
    CHECK(edges[0].resolution == CBERG_GRES_TEXTUAL || edges[0].resolution == CBERG_GRES_IMPORT, "import resolution set");
    CHECK(n == 1 && edges[0].confidence == 1.0f, "import edges are exact");

    /* Truncation contract: cap wins. */
    CHECK(cberg_graph_edges_from(c->graph, file_a->id, 0, edges, 2, &n) == CBERG_OK, "capped edges");
    CHECK(n == 2, "results truncate at cap");

    /* find_nodes filters: kind mask and path prefix. */
    const cberg_graph_node *found[16];
    CHECK(cberg_graph_find_nodes(c->graph, NULL, CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION), "b.go", found, 16, &n) == CBERG_OK, "find b.go functions");
    CHECK(n == 2, "b.go has two functions");
    CHECK(cberg_graph_find_nodes(c->graph, "helper", 0, "b.go", found, 16, &n) == CBERG_OK, "helper under b.go");
    CHECK(n == 0, "path prefix filters out a.go's helper");

    /* Unknown node for edge queries. */
    CHECK(cberg_graph_edges_from(c->graph, 0xDEAD, 0, edges, 16, &n) == CBERG_ERR_NOT_FOUND, "edges of unknown node");
}

static void test_trace(graph_corpus *c) {
    const cberg_graph_node *helper = corpus_node(c, "helper", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION));
    const cberg_graph_node *run = corpus_node(c, "run", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION));
    const cberg_graph_node *other = corpus_node(c, "other", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION));
    if (helper == NULL || run == NULL || other == NULL) {
        CHECK(0, "trace prerequisites missing");
        return;
    }

    /* Callees of run, one hop: helper and other. */
    cberg_graph_hop hops[32];
    size_t n = 0;
    CHECK(cberg_graph_trace(c->graph, run->id, CBERG_GRAPH_OUT, CBERG_GEDGE_CALLS, 1, hops, 32, &n) == CBERG_OK, "trace out from run");
    CHECK(n == 2, "run reaches two callees in one hop");

    /* Callers of helper across depth 2: Start and run at depth 1. */
    CHECK(cberg_graph_trace(c->graph, helper->id, CBERG_GRAPH_IN, CBERG_GEDGE_CALLS, 2, hops, 32, &n) == CBERG_OK, "trace in to helper");
    CHECK(n == 2, "helper has two callers");
    for (size_t i = 0; i < n; i++) {
        CHECK(hops[i].depth == 1, "direct callers are depth 1");
        CHECK(hops[i].edge.dst == helper->id, "caller edges point at helper");
    }

    /* Unknown start and bad direction. */
    CHECK(cberg_graph_trace(c->graph, 0xDEAD, CBERG_GRAPH_OUT, 0, 2, hops, 32, &n) == CBERG_ERR_NOT_FOUND, "trace unknown start");
    CHECK(cberg_graph_trace(c->graph, run->id, 0, 0, 2, hops, 32, &n) == CBERG_ERR_INVALID_ARGUMENT, "trace needs a direction");
}

static void test_incremental(graph_corpus *c) {
    const cberg_graph_node *helper = corpus_node(c, "helper", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION));
    if (helper == NULL) {
        CHECK(0, "incremental prerequisites missing");
        return;
    }
    uint64_t helper_id = helper->id;

    /* Re-index b.go without the helper() call: the stale caller edge must go. */
    CHECK(corpus_index(c, CBERG_LANG_GO, "b.go", B_GO_V2) == CBERG_OK, "reindex b.go");
    cberg_graph_edge edges[16];
    size_t n = 0;
    CHECK(cberg_graph_edges_to(c->graph, helper_id, CBERG_GEDGE_CALLS, edges, 16, &n) == CBERG_OK, "callers after edit");
    CHECK(n == 1, "only the same-file caller remains");

    /* Delete b.go entirely: its nodes disappear, nothing dangles. */
    CHECK(corpus_remove(c, "b.go") == CBERG_OK, "remove b.go");
    CHECK(corpus_node(c, "run", 0) == NULL, "run node removed with its file");
    CHECK(corpus_node(c, "b.go", CBERG_GNODE_MASK(CBERG_GNODE_FILE)) == NULL, "file node removed");
    CHECK(cberg_graph_edges_to(c->graph, helper_id, CBERG_GEDGE_CALLS, edges, 16, &n) == CBERG_OK, "callers after delete");
    CHECK(n == 1, "deleting a file leaves no dangling callers");

    /* Removing an unknown path is a harmless no-op. */
    CHECK(cberg_graph_remove_file(c->graph, "never/was.go") == CBERG_OK, "remove unknown path");
}

static void test_persistence(graph_corpus *c) {
    char path[] = "/tmp/cberg_graph_test_XXXXXX";
    int fd = mkstemp(path);
    CHECK(fd >= 0, "mkstemp");
    if (fd < 0) {
        return;
    }
    close(fd);

    CHECK(cberg_graph_save(c->graph, path) == CBERG_OK, "graph save");

    cberg_graph *loaded = NULL;
    CHECK(cberg_graph_load(path, &loaded) == CBERG_OK, "graph load");
    if (loaded != NULL) {
        size_t nodes_a = 0, refs_a = 0, nodes_b = 0, refs_b = 0;
        cberg_graph_counts(c->graph, &nodes_a, &refs_a);
        cberg_graph_counts(loaded, &nodes_b, &refs_b);
        CHECK(nodes_a == nodes_b, "load preserves node count");
        CHECK(refs_a == refs_b, "load preserves ref count");

        /* Queries behave identically on the restored graph. */
        const cberg_graph_node *helper = corpus_node(c, "helper", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION));
        if (helper != NULL) {
            cberg_graph_edge edges[16];
            size_t n = 0;
            CHECK(cberg_graph_edges_to(loaded, helper->id, CBERG_GEDGE_CALLS, edges, 16, &n) == CBERG_OK, "loaded callers");
            CHECK(n == 2, "loaded graph resolves the same callers");
        }
        cberg_graph_free(loaded);
    }

    /* Corrupt snapshots read back as NOT_FOUND (cold rebuild), never garbage. */
    FILE *f = fopen(path, "wb");
    CHECK(f != NULL, "rewrite snapshot");
    if (f != NULL) {
        fwrite("NOPE", 1, 4, f);
        fclose(f);
    }
    loaded = NULL;
    CHECK(cberg_graph_load(path, &loaded) == CBERG_ERR_NOT_FOUND, "bad magic loads as NOT_FOUND");
    unlink(path);
    CHECK(cberg_graph_load(path, &loaded) == CBERG_ERR_NOT_FOUND, "missing file loads as NOT_FOUND");
}

static void test_invalid_args(void) {
    CHECK(cberg_graph_new(NULL) == CBERG_ERR_INVALID_ARGUMENT, "graph_new NULL");
    cberg_graph_free(NULL); /* NULL-safe */
    cberg_graph_fragment_free(NULL);
    CHECK(cberg_graph_fragment_path(NULL) == NULL, "fragment_path NULL");

    cberg_graph *g = NULL;
    CHECK(cberg_graph_new(&g) == CBERG_OK, "graph_new");
    size_t n = 0;
    CHECK(cberg_graph_apply(g, NULL, NULL, NULL) == CBERG_ERR_INVALID_ARGUMENT, "apply NULL fragment");
    CHECK(cberg_graph_remove_file(g, NULL) == CBERG_ERR_INVALID_ARGUMENT, "remove NULL path");
    CHECK(cberg_graph_find_nodes(g, NULL, 0, NULL, NULL, 4, &n) == CBERG_ERR_INVALID_ARGUMENT, "find with NULL out");
    CHECK(cberg_graph_save(g, NULL) == CBERG_ERR_INVALID_ARGUMENT, "save NULL path");
    size_t nodes = 0;
    cberg_graph_counts(g, &nodes, NULL);
    CHECK(nodes == 0, "empty graph has no nodes");
    cberg_graph_free(g);
}

/* Ambiguous cross-file: confidence = 0.75 * min(1, 3/n) with n=4 → 0.5625. */
static void test_ambiguous_confidence(void) {
    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "ambiguous corpus");
    if (c.chunker == NULL) {
        return;
    }
    for (int i = 0; i < 4; i++) {
        char path[32];
        char src[64];
        snprintf(path, sizeof path, "t%d.go", i);
        snprintf(src, sizeof src, "package p\n\nfunc target() {}\n");
        CHECK(corpus_index(&c, CBERG_LANG_GO, path, src) == CBERG_OK, "index target def");
    }
    CHECK(corpus_index(&c, CBERG_LANG_GO, "caller.go", "package p\n\nfunc call() {\n\ttarget()\n}\n") == CBERG_OK,
          "index caller");

    const cberg_graph_node *targets[8];
    size_t nt = 0;
    CHECK(cberg_graph_find_nodes(c.graph, "target", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION), NULL, targets, 8, &nt) == CBERG_OK,
          "find targets");
    CHECK(nt == 4, "four target defs");
    if (nt < 1) {
        corpus_close(&c);
        return;
    }

    cberg_graph_edge edges[16];
    size_t n = 0;
    CHECK(cberg_graph_edges_to(c.graph, targets[0]->id, CBERG_GEDGE_CALLS, edges, 16, &n) == CBERG_OK, "edges_to target");
    CHECK(n == 1, "one caller edge per candidate");
    if (n == 1) {
        float want = 0.75f * (3.0f / 4.0f);
        CHECK(edges[0].confidence > want - 0.01f && edges[0].confidence < want + 0.01f, "ambiguous confidence 0.5625");
    }

    /* Hubs: helper-like unique name should report degree == caller count. */
    const cberg_graph_node *call = corpus_node(&c, "call", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION));
    CHECK(call != NULL, "call node");
    if (call != NULL) {
        cberg_graph_hub hubs[16];
        size_t hn = 0;
        CHECK(cberg_graph_hubs(c.graph, hubs, 16, &hn) == CBERG_OK, "hubs");
        int found_call = 0;
        for (size_t i = 0; i < hn; i++) {
            if (hubs[i].id == call->id) {
                found_call = 1;
                /* call → 4 ambiguous targets ⇒ out-degree 4 */
                CHECK(hubs[i].degree == 4, "call hub degree matches fan-out");
            }
        }
        CHECK(found_call, "call appears in hubs");
    }

    corpus_close(&c);
}

/* Component-aware path_prefix: "pkg" matches pkg/a.go but not pkgx/a.go. */
static void test_path_prefix_component(void) {
    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "prefix corpus");
    CHECK(corpus_index(&c, CBERG_LANG_GO, "pkg/a.go", "package pkg\n\nfunc Helper() {}\n") == CBERG_OK, "index pkg");
    CHECK(corpus_index(&c, CBERG_LANG_GO, "pkgx/a.go", "package pkgx\n\nfunc Helper() {}\n") == CBERG_OK, "index pkgx");

    const cberg_graph_node *nodes[8];
    size_t n = 0;
    CHECK(cberg_graph_find_nodes(c.graph, "Helper", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION), "pkg", nodes, 8, &n) == CBERG_OK,
          "find with prefix pkg");
    CHECK(n == 1, "prefix pkg matches one");
    if (n == 1) {
        CHECK(nodes[0]->path != NULL && strcmp(nodes[0]->path, "pkg/a.go") == 0, "matched pkg/a.go");
    }

    n = 0;
    CHECK(cberg_graph_find_nodes(c.graph, "Helper", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION), "pkg/", nodes, 8, &n) == CBERG_OK,
          "find with prefix pkg/");
    CHECK(n == 1, "trailing slash prefix matches one");

    n = 0;
    CHECK(cberg_graph_find_nodes(c.graph, "Helper", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION), "pkgx", nodes, 8, &n) == CBERG_OK,
          "find with prefix pkgx");
    CHECK(n == 1, "prefix pkgx matches one");

    corpus_close(&c);
}

/* Mid-apply OOM restores the prior file subgraph (Keep + Other, not Boom). */
typedef struct {
    cberg_chunk_table *table;
    int calls;
    int fail_after;
} fail_resolve_ctx;

static cberg_status fail_nth_resolve(void *ctx, const char *key, uint64_t *out_id) {
    fail_resolve_ctx *f = ctx;
    f->calls++;
    if (f->calls > f->fail_after) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    return corpus_resolver(f->table, key, out_id);
}

static void test_apply_restores_on_failure(void) {
    graph_corpus c;
    CHECK(corpus_open(&c) == 0, "restore corpus");
    const char *prior = "package p\n\nfunc Keep() {}\n\nfunc Other() {}\n";
    CHECK(corpus_index(&c, CBERG_LANG_GO, "a.go", prior) == CBERG_OK, "index a.go");
    const cberg_graph_node *keep_before = corpus_node(&c, "Keep", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION));
    const cberg_graph_node *other_before = corpus_node(&c, "Other", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION));
    const cberg_graph_node *file_before = corpus_node(&c, "a.go", CBERG_GNODE_MASK(CBERG_GNODE_FILE));
    CHECK(keep_before != NULL, "Keep before");
    CHECK(other_before != NULL, "Other before");
    CHECK(file_before != NULL, "file before");
    uint64_t keep_id = keep_before->id;
    uint64_t other_id = other_before->id;
    uint64_t file_id = file_before->id;

    cberg_graph_edge edges_before[16];
    size_t n_edges_before = 0;
    CHECK(cberg_graph_edges_from(c.graph, file_id, CBERG_GEDGE_DEFINES, edges_before, 16, &n_edges_before) == CBERG_OK,
          "file defines before");
    CHECK(n_edges_before >= 2, "file defined Keep and Other");

    const char *next = "package p\n\nfunc Keep() {}\n\nfunc Boom() {}\n\nfunc Extra() {}\n";
    cberg_chunk_list *list = NULL;
    cberg_graph_fragment *frag = NULL;
    CHECK(cberg_chunker_analyze(c.chunker, CBERG_LANG_GO, "a.go", next, strlen(next), &list, &frag) == CBERG_OK, "analyze next");
    CHECK(frag != NULL, "fragment extracted");
    if (list == NULL || frag == NULL) {
        cberg_graph_fragment_free(frag);
        cberg_chunk_list_free(list);
        corpus_close(&c);
        return;
    }
    CHECK(cberg_chunk_list_hash_bodies(list, next, strlen(next)) == CBERG_OK, "hash bodies");

    /* Sync new chunks so Keep+Boom can resolve; Extra's resolve will OOM after
     * Boom has already been inserted (brand-new id past the undo mark). */
    corpus_drop_path(&c, "a.go");
    size_t n = cberg_chunk_list_len(list);
    if (c.chunks_len + n > c.chunks_cap) {
        size_t cap = c.chunks_len + n;
        cberg_chunk *grown = realloc(c.chunks, cap * sizeof(*grown));
        CHECK(grown != NULL, "grow chunks");
        if (grown == NULL) {
            cberg_graph_fragment_free(frag);
            cberg_chunk_list_free(list);
            corpus_close(&c);
            return;
        }
        c.chunks = grown;
        c.chunks_cap = cap;
    }
    for (size_t i = 0; i < n; i++) {
        c.chunks[c.chunks_len++] = *cberg_chunk_list_at(list, i);
    }
    cberg_changes changes = {0};
    CHECK(cberg_chunk_table_sync(c.table, c.chunks, c.chunks_len, &changes) == CBERG_OK, "sync table");

    fail_resolve_ctx rctx = {.table = c.table, .calls = 0, .fail_after = 2};
    CHECK(cberg_graph_apply(c.graph, frag, fail_nth_resolve, &rctx) == CBERG_ERR_OUT_OF_MEMORY, "apply fails mid-way");
    CHECK(rctx.calls > 2, "resolver ran past Boom");

    CHECK(corpus_node(&c, "Keep", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION)) != NULL, "Keep restored");
    CHECK(corpus_node(&c, "Other", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION)) != NULL, "Other restored");
    CHECK(corpus_node(&c, "Boom", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION)) == NULL, "Boom not left behind");
    CHECK(corpus_node(&c, "Extra", CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION)) == NULL, "Extra not left behind");

    /* Id map must point at revived prior slots (not dead rebuild heads). */
    CHECK(cberg_graph_node_by_id(c.graph, keep_id) != NULL, "Keep id lookup restored");
    CHECK(cberg_graph_node_by_id(c.graph, other_id) != NULL, "Other id lookup restored");
    CHECK(cberg_graph_node_by_id(c.graph, file_id) != NULL, "file id lookup restored");
    CHECK(cberg_graph_node_by_id(c.graph, keep_id)->id == keep_id, "Keep id matches");
    CHECK(cberg_graph_node_by_id(c.graph, other_id)->id == other_id, "Other id matches");

    /* Boom was inserted past the undo mark then aborted: soft-clear must drop
     * its id map entry (not leave a dead-slot hit). */
    const cberg_stored_chunk *boom_chunk = NULL;
    for (size_t i = 0; i < cberg_chunk_table_len(c.table); i++) {
        const cberg_stored_chunk *sc = cberg_chunk_table_at(c.table, i);
        if (sc != NULL && sc->chunk.symbol != NULL && strcmp(sc->chunk.symbol, "Boom") == 0) {
            boom_chunk = sc;
            break;
        }
    }
    CHECK(boom_chunk != NULL, "Boom chunk present in table");
    if (boom_chunk != NULL) {
        CHECK(cberg_graph_node_by_id(c.graph, boom_chunk->id) == NULL, "Boom id soft-cleared after abort");
    }

    cberg_graph_edge edges[16];
    size_t n_edges = 0;
    CHECK(cberg_graph_edges_from(c.graph, file_id, CBERG_GEDGE_DEFINES, edges, 16, &n_edges) == CBERG_OK,
          "file defines after restore");
    CHECK(n_edges >= 2, "DEFINES edges restored");
    CHECK(edges_find(edges, n_edges, file_id, keep_id, CBERG_GEDGE_DEFINES) != NULL, "DEFINES Keep");
    CHECK(edges_find(edges, n_edges, file_id, other_id, CBERG_GEDGE_DEFINES) != NULL, "DEFINES Other");

    cberg_graph_fragment_free(frag);
    cberg_chunk_list_free(list);
    corpus_close(&c);
}

int main(void) {
    graph_corpus corpus;
    if (corpus_open(&corpus) != 0) {
        fprintf(stderr, "FAIL: corpus_open\n");
        return 1;
    }

    test_build_and_query(&corpus);
    test_trace(&corpus);
    test_persistence(&corpus); /* before incremental edits mutate the corpus */
    test_incremental(&corpus);
    test_invalid_args();
    corpus_close(&corpus);

    test_ambiguous_confidence();
    test_path_prefix_component();
    test_apply_restores_on_failure();

    TEST_MAIN_RETURN
}
