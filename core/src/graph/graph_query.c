/* Read side of the graph: edges, node search, traversal, and hubs. */
#include "graph_store.h"

#include <stdlib.h>
#include <string.h>

#include "grow.h"
#include "workspace_graph.h"

/* Returns nonzero to stop iteration (sink full). */
typedef int (*graph_edge_sink)(void *ctx, const cberg_graph_edge *edge);

static cberg_graph_edge make_edge(uint64_t src, uint64_t dst, uint8_t kind, cberg_graph_resolution resolution, float confidence, uint32_t line) {
    return (cberg_graph_edge){
        .src = src,
        .dst = dst,
        .kind = (cberg_graph_edge_kind)kind,
        .resolution = resolution,
        .confidence = confidence,
        .line = line,
    };
}

/* How a ref was resolved; refs stored without a resolution are textual matches. */
static cberg_graph_resolution ref_resolution(const graph_ref_rec *ref) {
    return ref->resolution != 0 ? (cberg_graph_resolution)ref->resolution : CBERG_GRES_TEXTUAL;
}

/* Confidence of a ref bound to a known node: same-file bindings rank below
 * import-resolved ones, which rank below exact ones. */
static float bound_ref_confidence(const graph_ref_rec *ref, cberg_graph_resolution resolution) {
    if (ref->binding == CBERG_BIND_LOCAL) {
        return GRAPH_CONF_SAME_FILE;
    }

    return resolution == CBERG_GRES_IMPORT ? GRAPH_CONF_IMPORT : GRAPH_CONF_EXACT;
}

static int emit_ref_candidates(const cberg_graph *g, const graph_ref_rec *ref, int as_source, graph_edge_sink sink, void *ctx, resolve_memo *memo) {
    graph_candidates cands;
    graph_resolve_name_cached(g, ref, memo, &cands);
    for (size_t c = 0; c < cands.count; c++) {
        uint64_t cand_id = g->nodes[cands.idx[c]].pub.id;
        cberg_graph_resolution res = ref_resolution(ref);
        cberg_graph_edge edge = as_source ? make_edge(cand_id, ref->src, ref->kind, res, cands.confidence, ref->line)
                                          : make_edge(ref->src, cand_id, ref->kind, res, cands.confidence, ref->line);
        if (sink(ctx, &edge)) {
            return 1;
        }
    }
    return 0;
}

/* DEFINES edges from a FILE to its symbols, synthesized from the path index
 * rather than stored. */
static int emit_defines_from(const cberg_graph *g, const graph_node_rec *rec, graph_edge_sink sink, void *ctx) {
    uint64_t head = 0;
    if (!cberg_strmap_get(g->node_by_path, rec->pub.qname, &head)) {
        return 0;
    }

    for (uint32_t i = (uint32_t)head; i != 0; i = g->nodes[i - 1].path_next) {
        const graph_node_rec *sym = &g->nodes[i - 1];
        if (sym->dead || sym->pub.kind == CBERG_GNODE_FILE) {
            continue;
        }

        cberg_graph_edge edge = make_edge(rec->pub.id, sym->pub.id, CBERG_GEDGE_DEFINES, CBERG_GRES_TEXTUAL, GRAPH_CONF_EXACT, sym->pub.span.start_line);
        if (sink(ctx, &edge)) {
            return 1;
        }
    }
    return 0;
}

/* Forward refs stored on this node: bound ones to their target, named ones to
 * every candidate the name resolves to. */
static int emit_stored_refs_from(const cberg_graph *g, const graph_node_rec *rec, uint32_t mask, graph_edge_sink sink, void *ctx, resolve_memo *memo) {
    uint64_t id = rec->pub.id;
    uint64_t head = 0;
    if (!cberg_u64map_get(g->ref_by_src, id, &head)) {
        return 0;
    }

    for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].src_next) {
        const graph_ref_rec *ref = &g->refs[i - 1];
        if (ref->dead || ref->rev || (mask & ref->kind) == 0) {
            continue;
        }

        if (ref->dst == 0) {
            if (emit_ref_candidates(g, ref, 0, sink, ctx, memo)) {
                return 1;
            }
            continue;
        }

        if (graph_node_rec_by_id(g, ref->dst) == NULL) {
            continue;
        }
        cberg_graph_resolution res = ref_resolution(ref);
        cberg_graph_edge edge = make_edge(id, ref->dst, ref->kind, res, bound_ref_confidence(ref, res), ref->line);
        if (sink(ctx, &edge)) {
            return 1;
        }
    }
    return 0;
}

/* Named refs whose name resolves to this node. Forward refs (callers,
 * subtypes, …) give ref source -> node and need a live source; reversed refs
 * (e.g. Go receiver methods) name this node as the container, giving
 * node -> ref source. */
static int emit_named_refs_to_self(const cberg_graph *g, const graph_node_rec *rec, uint32_t mask, int reversed, graph_edge_sink sink, void *ctx, resolve_memo *memo) {
    uint64_t head = 0;
    if (!cberg_strmap_get(g->ref_by_name, rec->pub.name, &head)) {
        return 0;
    }

    uint64_t id = rec->pub.id;
    uint32_t self_index = (uint32_t)(rec - g->nodes);
    for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].name_next) {
        const graph_ref_rec *ref = &g->refs[i - 1];
        if (ref->dead || (ref->rev != 0) != (reversed != 0) || (mask & ref->kind) == 0) {
            continue;
        }
        if (!reversed && graph_node_rec_by_id(g, ref->src) == NULL) {
            continue;
        }

        graph_candidates cands;
        graph_resolve_name_cached(g, ref, memo, &cands);
        if (!graph_candidates_contain(&cands, self_index)) {
            continue;
        }

        cberg_graph_resolution res = ref_resolution(ref);
        cberg_graph_edge edge = reversed ? make_edge(id, ref->src, ref->kind, res, cands.confidence, ref->line)
                                         : make_edge(ref->src, id, ref->kind, res, cands.confidence, ref->line);
        if (sink(ctx, &edge)) {
            return 1;
        }
    }
    return 0;
}

/* All resolved edges leaving `rec`'s node. */
static int emit_edges_from(const cberg_graph *g, const graph_node_rec *rec, uint32_t mask, graph_edge_sink sink, void *ctx) {
    resolve_memo memo = {0};

    if (rec->pub.kind == CBERG_GNODE_FILE && (mask & CBERG_GEDGE_DEFINES) != 0 && emit_defines_from(g, rec, sink, ctx)) {
        return 1;
    }

    return emit_stored_refs_from(g, rec, mask, sink, ctx, &memo) || emit_named_refs_to_self(g, rec, mask, 1, sink, ctx, &memo);
}

/* The DEFINES edge from a symbol's FILE node, when that file is in the graph. */
static int emit_defines_to(const cberg_graph *g, const graph_node_rec *rec, graph_edge_sink sink, void *ctx) {
    uint64_t fid = graph_file_id(rec->pub.path);
    if (graph_node_rec_by_id(g, fid) == NULL) {
        return 0;
    }

    cberg_graph_edge edge = make_edge(fid, rec->pub.id, CBERG_GEDGE_DEFINES, CBERG_GRES_TEXTUAL, GRAPH_CONF_EXACT, rec->pub.span.start_line);
    return sink(ctx, &edge);
}

/* Forward refs bound directly to this node, from live sources. */
static int emit_bound_refs_to(const cberg_graph *g, const graph_node_rec *rec, uint32_t mask, graph_edge_sink sink, void *ctx) {
    uint64_t id = rec->pub.id;
    uint64_t head = 0;
    if (!cberg_u64map_get(g->ref_by_dst, id, &head)) {
        return 0;
    }

    for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].dst_next) {
        const graph_ref_rec *ref = &g->refs[i - 1];
        if (ref->dead || ref->rev || (mask & ref->kind) == 0 || graph_node_rec_by_id(g, ref->src) == NULL) {
            continue;
        }

        cberg_graph_resolution res = ref_resolution(ref);
        cberg_graph_edge edge = make_edge(ref->src, id, ref->kind, res, bound_ref_confidence(ref, res), ref->line);
        if (sink(ctx, &edge)) {
            return 1;
        }
    }
    return 0;
}

/* Reversed refs stored on this node point back in: member <- container. */
static int emit_reversed_refs_to(const cberg_graph *g, const graph_node_rec *rec, uint32_t mask, graph_edge_sink sink, void *ctx, resolve_memo *memo) {
    uint64_t head = 0;
    if (!cberg_u64map_get(g->ref_by_src, rec->pub.id, &head)) {
        return 0;
    }

    for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].src_next) {
        const graph_ref_rec *ref = &g->refs[i - 1];
        if (ref->dead || !ref->rev || (mask & ref->kind) == 0) {
            continue;
        }
        if (emit_ref_candidates(g, ref, 1, sink, ctx, memo)) {
            return 1;
        }
    }
    return 0;
}

/* All resolved edges arriving at `rec`'s node. */
static int emit_edges_to(const cberg_graph *g, const graph_node_rec *rec, uint32_t mask, graph_edge_sink sink, void *ctx) {
    resolve_memo memo = {0};

    bool defines = rec->pub.kind != CBERG_GNODE_FILE && rec->pub.path != NULL && (mask & CBERG_GEDGE_DEFINES) != 0;
    if (defines && emit_defines_to(g, rec, sink, ctx)) {
        return 1;
    }

    return emit_bound_refs_to(g, rec, mask, sink, ctx) || emit_named_refs_to_self(g, rec, mask, 0, sink, ctx, &memo) ||
           emit_reversed_refs_to(g, rec, mask, sink, ctx, &memo);
}

typedef struct edge_collect_ctx {
    cberg_graph_edge *out;
    size_t cap;
    size_t count;
} edge_collect_ctx;

static int edge_collect(void *v, const cberg_graph_edge *edge) {
    edge_collect_ctx *ctx = v;
    if (ctx->count >= ctx->cap) {
        return 1;
    }
    ctx->out[ctx->count++] = *edge;
    return ctx->count >= ctx->cap;
}

static cberg_status graph_edges(const cberg_graph *graph, uint64_t id, uint32_t kind_mask, int outgoing, cberg_graph_edge *out_edges, size_t cap, size_t *out_count) {
    if (graph == NULL || out_count == NULL || (out_edges == NULL && cap > 0)) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_count = 0;
    const graph_node_rec *rec = graph_node_rec_by_id(graph, id);
    if (rec == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    uint32_t mask = kind_mask == 0 ? CBERG_GEDGE_ALL : kind_mask;
    edge_collect_ctx ctx = {.out = out_edges, .cap = cap};
    if (outgoing) {
        emit_edges_from(graph, rec, mask, edge_collect, &ctx);
    } else {
        emit_edges_to(graph, rec, mask, edge_collect, &ctx);
    }
    *out_count = ctx.count;
    return CBERG_OK;
}

cberg_status cberg_graph_edges_from(const cberg_graph *graph, uint64_t id, uint32_t kind_mask, cberg_graph_edge *out_edges, size_t cap, size_t *out_count) {
    return graph_edges(graph, id, kind_mask, 1, out_edges, cap, out_count);
}

cberg_status cberg_graph_edges_to(const cberg_graph *graph, uint64_t id, uint32_t kind_mask, cberg_graph_edge *out_edges, size_t cap, size_t *out_count) {
    return graph_edges(graph, id, kind_mask, 0, out_edges, cap, out_count);
}

/* ----------------------------------------------------------------- search */

/* Component-aware path prefix: "foo" matches "foo" and "foo/bar" but not "foobar". */
static int path_matches_prefix(const char *path, const char *prefix, size_t prefix_len) {
    if (prefix_len == 0) {
        return 1;
    }
    if (path == NULL || strncmp(path, prefix, prefix_len) != 0) {
        return 0;
    }
    char next = path[prefix_len];
    return next == '\0' || next == '/' || prefix[prefix_len - 1] == '/';
}

/* A live node of an allowed kind, inside the graph's repo scope and under the
 * path prefix. A zero kind mask and an empty prefix each match everything. */
static int node_matches(const cberg_graph *graph, const graph_node_rec *rec, uint32_t kind_mask, const char *path_prefix, size_t prefix_len) {
    if (rec->dead || (kind_mask != 0 && (kind_mask & CBERG_GNODE_MASK(rec->pub.kind)) == 0)) {
        return 0;
    }

    if (graph->scope != NULL && (rec->repo == NULL || strcmp(rec->repo, graph->scope) != 0)) {
        return 0;
    }

    return prefix_len == 0 || path_matches_prefix(cberg_graph_source_path(graph, &rec->pub), path_prefix, prefix_len);
}

cberg_status cberg_graph_find_nodes(const cberg_graph *graph, const char *name, uint32_t kind_mask, const char *path_prefix, const cberg_graph_node **out_nodes, size_t cap, size_t *out_count) {
    if (graph == NULL || out_count == NULL || (out_nodes == NULL && cap > 0)) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_count = 0;
    size_t prefix_len = path_prefix != NULL ? strlen(path_prefix) : 0;

    if (name != NULL) {
        uint64_t head = 0;
        if (!cberg_strmap_get(graph->node_by_name, name, &head)) {
            return CBERG_OK;
        }
        for (uint32_t i = (uint32_t)head; i != 0 && *out_count < cap; i = graph->nodes[i - 1].name_next) {
            const graph_node_rec *rec = &graph->nodes[i - 1];
            if (!node_matches(graph, rec, kind_mask, path_prefix, prefix_len)) {
                continue;
            }
            out_nodes[(*out_count)++] = &rec->pub;
        }
        return CBERG_OK;
    }

    for (size_t i = 0; i < graph->nodes_len && *out_count < cap; i++) {
        const graph_node_rec *rec = &graph->nodes[i];
        if (!node_matches(graph, rec, kind_mask, path_prefix, prefix_len)) {
            continue;
        }
        out_nodes[(*out_count)++] = &rec->pub;
    }
    return CBERG_OK;
}

/* -------------------------------------------------------------- traversal */

typedef struct trace_ctx {
    const cberg_graph *g;
    cberg_u64map *visited;
    uint64_t current; /* node being expanded */
    uint64_t *next;   /* next BFS frontier */
    size_t next_len, next_cap;
    cberg_graph_hop *out;
    size_t cap, count;
    uint32_t depth;
    cberg_status err;
} trace_ctx;

static int trace_sink(void *v, const cberg_graph_edge *edge) {
    trace_ctx *t = v;
    uint64_t neighbor = edge->src == t->current ? edge->dst : edge->src;
    /* A self-loop (recursion) still reports a hop but expands nothing new. */
    if (neighbor != t->current && cberg_u64map_get(t->visited, neighbor, NULL)) {
        return 0;
    }
    if (t->count >= t->cap) {
        return 1;
    }
    t->out[t->count].edge = *edge;
    t->out[t->count].depth = t->depth;
    t->count++;
    if (neighbor != t->current) {
        if (cberg_u64map_set(t->visited, neighbor, 1) != CBERG_OK) {
            t->err = CBERG_ERR_OUT_OF_MEMORY;
            return 1;
        }
        size_t cap = cberg_grow_cap(t->next_cap, t->next_len + 1, 16);
        if (cap != t->next_cap) {
            uint64_t *grown = realloc(t->next, cap * sizeof(*grown));
            if (grown == NULL) {
                t->err = CBERG_ERR_OUT_OF_MEMORY;
                return 1;
            }
            t->next = grown;
            t->next_cap = cap;
        }
        t->next[t->next_len++] = neighbor;
    }
    return t->count >= t->cap;
}

cberg_status cberg_graph_trace(const cberg_graph *graph, uint64_t start_id, uint32_t directions, uint32_t kind_mask, uint32_t max_depth, cberg_graph_hop *out_hops, size_t cap, size_t *out_count) {
    if (graph == NULL || out_count == NULL || (out_hops == NULL && cap > 0) ||
        (directions & (CBERG_GRAPH_OUT | CBERG_GRAPH_IN)) == 0) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_count = 0;
    if (graph_node_rec_by_id(graph, start_id) == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    uint32_t mask = kind_mask == 0 ? CBERG_GEDGE_ALL : kind_mask;

    trace_ctx t = {.g = graph, .out = out_hops, .cap = cap};
    t.visited = cberg_u64map_new(256);
    if (t.visited == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    cberg_status st = cberg_u64map_set(t.visited, start_id, 1);

    uint64_t *frontier = NULL;
    size_t frontier_len = 0;
    if (st == CBERG_OK) {
        frontier = malloc(sizeof(*frontier));
        if (frontier == NULL) {
            st = CBERG_ERR_OUT_OF_MEMORY;
        } else {
            frontier[0] = start_id;
            frontier_len = 1;
        }
    }

    for (uint32_t depth = 1; st == CBERG_OK && depth <= max_depth && frontier_len > 0 && t.count < cap; depth++) {
        t.depth = depth;
        t.next_len = 0;
        for (size_t i = 0; i < frontier_len && st == CBERG_OK; i++) {
            const graph_node_rec *rec = graph_node_rec_by_id(graph, frontier[i]);
            if (rec == NULL) {
                continue;
            }
            t.current = frontier[i];
            int stop = 0;
            if ((directions & CBERG_GRAPH_OUT) != 0) {
                stop = emit_edges_from(graph, rec, mask, trace_sink, &t);
            }
            if (!stop && (directions & CBERG_GRAPH_IN) != 0) {
                stop = emit_edges_to(graph, rec, mask, trace_sink, &t);
            }
            st = t.err;
            if (stop) {
                break;
            }
        }
        /* Swap frontiers. */
        free(frontier);
        frontier = t.next;
        frontier_len = t.next_len;
        t.next = NULL;
        t.next_len = 0;
        t.next_cap = 0;
    }

    free(frontier);
    free(t.next);
    cberg_u64map_free(t.visited);
    if (st == CBERG_OK) {
        *out_count = t.count;
    }
    return st;
}

static int hub_cmp(const void *a, const void *b) {
    const cberg_graph_hub *ha = a;
    const cberg_graph_hub *hb = b;
    if (ha->degree != hb->degree) {
        return hb->degree > ha->degree ? 1 : -1;
    }
    return ha->id < hb->id ? -1 : (ha->id > hb->id ? 1 : 0);
}

/*
 * Single-pass CALLS degree: walk each live CALLS ref once, resolve name refs
 * once, and bump both endpoints. Matches emit_edges_from/to CALLS counting
 * without O(nodes × refs-per-name) re-resolution.
 */
static void hubs_bump(uint32_t *deg, size_t n, uint32_t idx) {
    if (idx < n) {
        deg[idx]++;
    }
}

cberg_status cberg_graph_hubs(const cberg_graph *graph, cberg_graph_hub *out, size_t cap, size_t *out_count) {
    if (graph == NULL || out == NULL || out_count == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_count = 0;
    if (graph->nodes_len == 0) {
        return CBERG_OK;
    }
    uint32_t *deg = calloc(graph->nodes_len, sizeof(*deg));
    if (deg == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    resolve_memo memo = {0};
    for (size_t r = 0; r < graph->refs_len; r++) {
        const graph_ref_rec *ref = &graph->refs[r];
        if (ref->dead || ref->kind != CBERG_GEDGE_CALLS || ref->rev) {
            continue;
        }
        const graph_node_rec *src = graph_node_rec_by_id(graph, ref->src);
        if (src == NULL) {
            continue;
        }
        uint32_t src_idx = (uint32_t)(src - graph->nodes);
        if (ref->dst != 0) {
            const graph_node_rec *dst = graph_node_rec_by_id(graph, ref->dst);
            if (dst == NULL) {
                continue;
            }
            hubs_bump(deg, graph->nodes_len, src_idx);
            hubs_bump(deg, graph->nodes_len, (uint32_t)(dst - graph->nodes));
            continue;
        }
        if (ref->name == NULL) {
            continue;
        }
        graph_candidates cands;
        graph_resolve_name_cached(graph, ref, &memo, &cands);
        if (cands.count == 0) {
            continue;
        }
        /* One edge per candidate: src degree += N, each candidate += 1. */
        for (size_t c = 0; c < cands.count; c++) {
            hubs_bump(deg, graph->nodes_len, src_idx);
            hubs_bump(deg, graph->nodes_len, cands.idx[c]);
        }
    }

    cberg_graph_hub *tmp = calloc(graph->nodes_len + 1, sizeof(*tmp));
    if (tmp == NULL) {
        free(deg);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t n = 0;
    for (size_t i = 0; i < graph->nodes_len; i++) {
        const graph_node_rec *rec = &graph->nodes[i];
        if (rec->dead || rec->pub.kind == CBERG_GNODE_FILE || rec->pub.kind == CBERG_GNODE_MODULE) {
            continue;
        }
        if (graph->scope != NULL && (rec->repo == NULL || strcmp(rec->repo, graph->scope) != 0))
            continue;
        if (deg[i] == 0) {
            continue;
        }
        tmp[n].id = rec->pub.id;
        tmp[n].degree = deg[i];
        n++;
    }
    free(deg);
    qsort(tmp, n, sizeof(*tmp), hub_cmp);
    size_t write = n < cap ? n : cap;
    memcpy(out, tmp, write * sizeof(*out));
    *out_count = write;
    free(tmp);
    return CBERG_OK;
}
