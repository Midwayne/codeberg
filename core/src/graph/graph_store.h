#ifndef CBERG_GRAPH_STORE_H
#define CBERG_GRAPH_STORE_H

/*
 * The graph's in-memory layout, shared by the files that implement
 * cberg_graph_*. Nothing outside src/graph includes this.
 *
 *   graph_store.c      records, indexes, insertion, compaction, lifecycle
 *   graph_apply.c      apply one file's fragment; rewrite resolved imports
 *   graph_resolve.c    query-time name resolution
 *   graph_query.c      edges, node search, traversal, hubs
 *   graph_persist.c    save and load
 *   graph_workspace.c  the multi-repository view
 */

#include "codeberg/codeberg.h"

#include "arena.h"
#include "graph_internal.h"
#include "strmap.h"
#include "u64map.h"

#define GRAPH_CONF_EXACT 1.0f
#define GRAPH_CONF_IMPORT 0.95f
#define GRAPH_CONF_SAME_FILE 0.90f
#define GRAPH_CONF_GLOBAL 0.75f
#define GRAPH_CANDIDATE_PENALTY_CAP 3.0f
/* Fan-out cap for one reference: an ambiguous name links to at most this many
 * candidate definitions (keeps hub names like "get" from exploding traces). */
#define GRAPH_MAX_CANDIDATES 8

/* Compact when tombstones outnumber half the entries (and are non-trivial). */
#define GRAPH_COMPACT_MIN_DEAD 256

/* Synthetic ids (file / module nodes) set the top bit; chunk ids are small
 * sequential integers, so the two spaces cannot collide. */
#define GRAPH_SYNTHETIC_ID (1ULL << 63)

typedef struct graph_node_rec {
    cberg_graph_node pub; /* strings owned by the graph arena */
    const char *repo;     /* workspace view only, graph arena */
    uint64_t native_id;
    uint32_t name_next; /* +1 encoded chain over same-name nodes; 0 = end */
    uint32_t path_next;
    uint8_t dead;
} graph_node_rec;

typedef struct graph_ref_rec {
    uint64_t src;
    uint64_t dst;     /* pre-resolved target id, or 0 = resolve `name` */
    const char *name; /* arena; NULL when dst != 0 */
    const char *path; /* arena; owning file (removal unit) */
    uint32_t line;
    uint8_t kind;       /* one cberg_graph_edge_kind bit */
    uint8_t rev;        /* reversed: resolved edge is (candidate -> src) */
    uint8_t resolution; /* cberg_graph_resolution; persisted since CBERG_GRAPH_VERSION 1 */
    uint8_t binding;
    const char *module;
    const char *owner;
    uint8_t dead;
    uint32_t name_next;
    uint32_t src_next;
    uint32_t dst_next;
    uint32_t path_next;
} graph_ref_rec;

struct cberg_graph {
    uint64_t revision;
    int workspace;
    const char *scope; /* borrowed for the duration of a serialized query */
    cberg_arena *arena;
    graph_node_rec *nodes;
    size_t nodes_len, nodes_cap, nodes_dead;
    graph_ref_rec *refs;
    size_t refs_len, refs_cap, refs_dead;
    cberg_u64map *node_by_id; /* id -> node index+1 */
    cberg_strmap *node_by_name;
    cberg_strmap *node_by_path;
    cberg_u64map *ref_by_src; /* src id -> head ref index+1 */
    cberg_u64map *ref_by_dst; /* dst id -> head ref index+1 (dst != 0 only) */
    cberg_strmap *ref_by_name;
    cberg_strmap *ref_by_path;
};

/* ------------------------------------------------------------------ store */

/* Synthetic id for a tagged string ('F' file, 'M' module); 0 on OOM. */
uint64_t graph_tagged_id(char tag, const char *s);
uint64_t graph_file_id(const char *path);

/* The live node with this id, or NULL. */
graph_node_rec *graph_node_rec_by_id(const cberg_graph *g, uint64_t id);

/* Both copy their argument (strings included) into the store and index it. */
cberg_status graph_add_node(cberg_graph *g, const cberg_graph_node *pub);
cberg_status graph_add_ref(cberg_graph *g, const graph_ref_rec *tpl);

/* Get-or-create the module node an import points at. */
cberg_status graph_ensure_module_node(cberg_graph *g, const char *name, cberg_language lang, uint64_t *out_id);

/* Rebuild the store from its live entries once tombstones dominate. Slot
 * indexes are invalid afterwards. */
void graph_maybe_compact(cberg_graph *g);

/* ------------------------------------------------------------- resolution */

/* The definitions a name reference may mean, best guess first. */
typedef struct graph_candidates {
    uint32_t idx[GRAPH_MAX_CANDIDATES]; /* node indexes, chain order */
    size_t count;
    float confidence;
} graph_candidates;

/* Query-local memo: many CALLS refs share (name, path, kind) within one emit. */
typedef struct {
    const char *name;
    const char *path;
    uint8_t kind;
    uint8_t valid;
    uint8_t binding;
    const char *module;
    const char *owner;
    graph_candidates cands;
} resolve_memo;

/* Resolves `reference` by name. A zeroed memo may be reused across calls
 * within one query to skip repeated lookups. */
void graph_resolve_name_cached(const cberg_graph *g, const graph_ref_rec *reference, resolve_memo *memo, graph_candidates *out);

int graph_candidates_contain(const graph_candidates *c, uint32_t node_index);

#endif /* CBERG_GRAPH_STORE_H */
