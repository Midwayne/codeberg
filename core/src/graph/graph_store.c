/*
 * Knowledge-graph store (ADR 0005). RAM-first: nodes and reference records
 * live in flat arrays with open-addressing indexes; persistence is a single
 * binary dump beside the chunk table (atomic temp+rename).
 *
 * Name references (calls, inherits) resolve at *query time* against the live
 * definition index, so incremental deletes can never leave a dangling edge:
 * removing a file kills its nodes and its reference records, and every later
 * query re-links names against what still exists.
 *
 * Textual confidence: same-file name match 0.90; unique cross-file 0.75;
 * ambiguous candidates share 0.75 * min(1, 3/count). Import-resolved edges
 * use 0.95 (see resolve_pkg.c).
 */
#include "codeberg/codeberg.h"

#include <stdlib.h>
#include <string.h>

#include "arena.h"
#include "binio.h"
#include "graph_internal.h"
#include "grow.h"
#include "strmap.h"
#include "u64map.h"
#include "graph_workspace.h"

#define GRAPH_CONF_EXACT 1.0f
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

/* ---------------------------------------------------------------- helpers */

static uint64_t graph_tagged_id(char tag, const char *s) {
    uint8_t h[CBERG_HASH_LEN];
    size_t n = strlen(s);
    if (n > SIZE_MAX - 2) {
        return 0;
    }
    char *buf = malloc(n + 2);
    if (buf == NULL) {
        return 0;
    }
    buf[0] = tag;
    buf[1] = '\0';
    memcpy(buf + 2, s, n);
    uint64_t id = 0;
    if (cberg_hash(buf, n + 2, h) == CBERG_OK) {
        memcpy(&id, h, sizeof id);
    }
    free(buf);
    return id | GRAPH_SYNTHETIC_ID;
}

static uint64_t graph_file_id(const char *path) {
    return graph_tagged_id('F', path);
}

static uint64_t graph_module_id(const char *name) {
    return graph_tagged_id('M', name);
}

static const char *path_basename(const char *path) {
    const char *slash = strrchr(path, '/');
    return (slash != NULL && slash[1] != '\0') ? slash + 1 : path;
}

static cberg_graph_node_kind node_kind_from_chunk(cberg_chunk_kind kind) {
    switch (kind) {
    case CBERG_CHUNK_FUNCTION:
        return CBERG_GNODE_FUNCTION;
    case CBERG_CHUNK_METHOD:
        return CBERG_GNODE_METHOD;
    case CBERG_CHUNK_CLASS:
        return CBERG_GNODE_CLASS;
    case CBERG_CHUNK_STRUCT:
        return CBERG_GNODE_STRUCT;
    case CBERG_CHUNK_INTERFACE:
        return CBERG_GNODE_INTERFACE;
    default:
        return CBERG_GNODE_FILE; /* callers must not pass non-symbol kinds */
    }
}

/* Node kinds a reference of `ref_kind` may link to. */
static uint32_t candidate_kind_mask(uint8_t ref_kind) {
    switch (ref_kind) {
    case CBERG_GEDGE_CALLS:
        return CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION) | CBERG_GNODE_MASK(CBERG_GNODE_METHOD) |
               CBERG_GNODE_MASK(CBERG_GNODE_CLASS) | CBERG_GNODE_MASK(CBERG_GNODE_STRUCT);
    case CBERG_GEDGE_INHERITS:
    case CBERG_GEDGE_CONTAINS:
        return CBERG_GNODE_MASK(CBERG_GNODE_CLASS) | CBERG_GNODE_MASK(CBERG_GNODE_STRUCT) |
               CBERG_GNODE_MASK(CBERG_GNODE_INTERFACE);
    default:
        return CBERG_GNODE_MASK(CBERG_GNODE_FUNCTION) | CBERG_GNODE_MASK(CBERG_GNODE_METHOD) |
               CBERG_GNODE_MASK(CBERG_GNODE_CLASS) | CBERG_GNODE_MASK(CBERG_GNODE_STRUCT) |
               CBERG_GNODE_MASK(CBERG_GNODE_INTERFACE);
    }
}

static graph_node_rec *node_rec_by_id(const cberg_graph *g, uint64_t id) {
    uint64_t idx1 = 0;
    if (id == 0 || !cberg_u64map_get(g->node_by_id, id, &idx1) || idx1 == 0) {
        return NULL;
    }
    graph_node_rec *rec = &g->nodes[idx1 - 1];
    /* The id map keeps no tombstones; a dead or recycled slot means gone. */
    if (rec->dead || rec->pub.id != id) {
        return NULL;
    }
    return rec;
}

/* ------------------------------------------------------------- insertion */

static cberg_status chain_push_str(cberg_strmap *map, const char *key, uint32_t index, uint32_t *next_field) {
    uint64_t head = 0;
    cberg_strmap_get(map, key, &head);
    *next_field = (uint32_t)head;
    return cberg_strmap_set(map, key, (uint64_t)index + 1);
}

static cberg_status chain_push_u64(cberg_u64map *map, uint64_t key, uint32_t index, uint32_t *next_field) {
    uint64_t head = 0;
    cberg_u64map_get(map, key, &head);
    *next_field = (uint32_t)head;
    return cberg_u64map_set(map, key, (uint64_t)index + 1);
}

/* Copies `pub` (strings included) into the store and indexes it. */
static cberg_status graph_add_node(cberg_graph *g, const cberg_graph_node *pub) {
    if (g->nodes_len >= UINT32_MAX) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t cap = cberg_grow_cap(g->nodes_cap, g->nodes_len + 1, 64);
    if (cap == SIZE_MAX || (cap > 0 && cap > SIZE_MAX / sizeof(graph_node_rec))) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    if (cap != g->nodes_cap) {
        graph_node_rec *grown = realloc(g->nodes, cap * sizeof(*grown));
        if (grown == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        g->nodes = grown;
        g->nodes_cap = cap;
    }
    graph_node_rec *rec = &g->nodes[g->nodes_len];
    memset(rec, 0, sizeof(*rec));
    rec->pub = *pub;
    rec->pub.name = cberg_arena_strdup(g->arena, pub->name);
    rec->pub.qname = cberg_arena_strdup(g->arena, pub->qname);
    rec->pub.path = pub->path != NULL ? cberg_arena_strdup(g->arena, pub->path) : NULL;
    if (rec->pub.name == NULL || rec->pub.qname == NULL || (pub->path != NULL && rec->pub.path == NULL)) {
        memset(rec, 0, sizeof(*rec));
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    uint32_t index = (uint32_t)g->nodes_len;
    cberg_status st = chain_push_str(g->node_by_name, rec->pub.name, index, &rec->name_next);
    if (st == CBERG_OK && rec->pub.path != NULL) {
        st = chain_push_str(g->node_by_path, rec->pub.path, index, &rec->path_next);
    }
    if (st == CBERG_OK) {
        st = cberg_u64map_set(g->node_by_id, rec->pub.id, (uint64_t)index + 1);
    }
    /* Always consume the slot: maps may already point at `index`, so leaving
     * nodes_len unchanged would let the next insert reuse a live chain head. */
    g->nodes_len++;
    g->revision++;
    if (st != CBERG_OK) {
        rec->dead = 1;
        g->nodes_dead++;
        return st;
    }
    return CBERG_OK;
}

static cberg_status graph_add_ref(cberg_graph *g, const graph_ref_rec *tpl) {
    if (g->refs_len >= UINT32_MAX) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t cap = cberg_grow_cap(g->refs_cap, g->refs_len + 1, 64);
    if (cap == SIZE_MAX || (cap > 0 && cap > SIZE_MAX / sizeof(graph_ref_rec))) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    if (cap != g->refs_cap) {
        graph_ref_rec *grown = realloc(g->refs, cap * sizeof(*grown));
        if (grown == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        g->refs = grown;
        g->refs_cap = cap;
    }
    graph_ref_rec *rec = &g->refs[g->refs_len];
    memset(rec, 0, sizeof(*rec));
    rec->src = tpl->src;
    rec->dst = tpl->dst;
    rec->line = tpl->line;
    rec->kind = tpl->kind;
    rec->rev = tpl->rev;
    rec->resolution = tpl->resolution;
    rec->binding = tpl->binding;
    rec->module = tpl->module != NULL ? cberg_arena_strdup(g->arena, tpl->module) : NULL;
    rec->owner = tpl->owner != NULL ? cberg_arena_strdup(g->arena, tpl->owner) : NULL;
    rec->name = tpl->name != NULL ? cberg_arena_strdup(g->arena, tpl->name) : NULL;
    rec->path = cberg_arena_strdup(g->arena, tpl->path);
    if (rec->path == NULL || (tpl->name != NULL && rec->name == NULL) ||
        (tpl->module != NULL && rec->module == NULL) || (tpl->owner != NULL && rec->owner == NULL)) {
        memset(rec, 0, sizeof(*rec));
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    uint32_t index = (uint32_t)g->refs_len;
    cberg_status st = chain_push_u64(g->ref_by_src, rec->src, index, &rec->src_next);
    if (st == CBERG_OK && rec->dst != 0) {
        st = chain_push_u64(g->ref_by_dst, rec->dst, index, &rec->dst_next);
    }
    if (st == CBERG_OK && rec->name != NULL) {
        st = chain_push_str(g->ref_by_name, rec->name, index, &rec->name_next);
    }
    if (st == CBERG_OK) {
        st = chain_push_str(g->ref_by_path, rec->path, index, &rec->path_next);
    }
    g->refs_len++;
    g->revision++;
    if (st != CBERG_OK) {
        rec->dead = 1;
        g->refs_dead++;
        return st;
    }
    return CBERG_OK;
}

/* Get-or-create the module node an import points at. */
static cberg_status ensure_module_node(cberg_graph *g, const char *name, cberg_language lang, uint64_t *out_id) {
    uint64_t id = graph_module_id(name);
    if (id == 0) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    if (node_rec_by_id(g, id) == NULL) {
        cberg_graph_node node = {
            .id = id,
            .kind = CBERG_GNODE_MODULE,
            .lang = lang,
            .name = name,
            .qname = name,
            .path = NULL,
        };
        cberg_status st = graph_add_node(g, &node);
        if (st != CBERG_OK) {
            return st;
        }
    }
    *out_id = id;
    return CBERG_OK;
}

/* ------------------------------------------------------------- compaction */

/*
 * Tombstoned slots (and their arena strings) accumulate as watched files
 * churn; once they outnumber the live entries, rebuild the store from the
 * live set. The new store is built completely before the old one is torn
 * down, so failure leaves the graph untouched.
 */
static int module_has_importer(const cberg_graph *g, uint64_t module_id) {
    uint64_t head = 0;
    if (!cberg_u64map_get(g->ref_by_dst, module_id, &head)) {
        return 0;
    }
    for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].dst_next) {
        const graph_ref_rec *ref = &g->refs[i - 1];
        if (!ref->dead && ref->kind == CBERG_GEDGE_IMPORTS && node_rec_by_id(g, ref->src) != NULL) {
            return 1;
        }
    }
    return 0;
}

static cberg_status graph_compact(cberg_graph *g) {
    cberg_graph *fresh = NULL;
    cberg_status st = cberg_graph_new(&fresh);
    if (st != CBERG_OK) {
        return st;
    }
    for (size_t i = 0; i < g->nodes_len && st == CBERG_OK; i++) {
        if (g->nodes[i].dead) {
            continue;
        }
        /* Drop orphan MODULE nodes with no live IMPORTS importers. */
        if (g->nodes[i].pub.kind == CBERG_GNODE_MODULE && !module_has_importer(g, g->nodes[i].pub.id)) {
            continue;
        }
        st = graph_add_node(fresh, &g->nodes[i].pub);
        if (st == CBERG_OK && g->nodes[i].repo != NULL) {
            graph_node_rec *copy = &fresh->nodes[fresh->nodes_len - 1];
            copy->repo = cberg_arena_strdup(fresh->arena, g->nodes[i].repo);
            copy->native_id = g->nodes[i].native_id;
            if (copy->repo == NULL)
                st = CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    for (size_t i = 0; i < g->refs_len && st == CBERG_OK; i++) {
        if (g->refs[i].dead) {
            continue;
        }
        /* Skip refs whose endpoints were GC'd (orphan modules). */
        if (node_rec_by_id(fresh, g->refs[i].src) == NULL) {
            continue;
        }
        if (g->refs[i].dst != 0 && node_rec_by_id(fresh, g->refs[i].dst) == NULL) {
            continue;
        }
        st = graph_add_ref(fresh, &g->refs[i]);
    }
    if (st != CBERG_OK) {
        cberg_graph_free(fresh);
        return st;
    }
    fresh->workspace = g->workspace;
    fresh->scope = g->scope;
    fresh->revision = g->revision + 1;
    cberg_graph old = *g;
    *g = *fresh;
    free(fresh);
    /* Free the old guts (not the struct we now occupy). */
    cberg_arena_free(old.arena);
    free(old.nodes);
    free(old.refs);
    cberg_u64map_free(old.node_by_id);
    cberg_strmap_free(old.node_by_name);
    cberg_strmap_free(old.node_by_path);
    cberg_u64map_free(old.ref_by_src);
    cberg_u64map_free(old.ref_by_dst);
    cberg_strmap_free(old.ref_by_name);
    cberg_strmap_free(old.ref_by_path);
    return CBERG_OK;
}

static void graph_maybe_compact(cberg_graph *g) {
    size_t dead = g->nodes_dead + g->refs_dead;
    size_t total = g->nodes_len + g->refs_len;
    if (dead >= GRAPH_COMPACT_MIN_DEAD && dead * 2 > total) {
        /* Best-effort: on OOM the tombstoned store still answers correctly. */
        (void)graph_compact(g);
    }
}

/* ---------------------------------------------------------------- public */

cberg_status cberg_graph_new(cberg_graph **out_graph) {
    if (out_graph == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_graph *g = calloc(1, sizeof(*g));
    if (g == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    g->arena = cberg_arena_new();
    g->node_by_id = cberg_u64map_new(1024);
    g->node_by_name = cberg_strmap_new(1024);
    g->node_by_path = cberg_strmap_new(1024);
    g->ref_by_src = cberg_u64map_new(1024);
    g->ref_by_dst = cberg_u64map_new(1024);
    g->ref_by_name = cberg_strmap_new(1024);
    g->ref_by_path = cberg_strmap_new(1024);
    if (g->arena == NULL || g->node_by_id == NULL || g->node_by_name == NULL || g->node_by_path == NULL ||
        g->ref_by_src == NULL || g->ref_by_dst == NULL || g->ref_by_name == NULL || g->ref_by_path == NULL) {
        cberg_graph_free(g);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    *out_graph = g;
    return CBERG_OK;
}

void cberg_graph_free(cberg_graph *graph) {
    if (graph == NULL) {
        return;
    }
    cberg_arena_free(graph->arena);
    free(graph->nodes);
    free(graph->refs);
    cberg_u64map_free(graph->node_by_id);
    cberg_strmap_free(graph->node_by_name);
    cberg_strmap_free(graph->node_by_path);
    cberg_u64map_free(graph->ref_by_src);
    cberg_u64map_free(graph->ref_by_dst);
    cberg_strmap_free(graph->ref_by_name);
    cberg_strmap_free(graph->ref_by_path);
    free(graph);
}

void cberg_graph_counts(const cberg_graph *graph, size_t *out_nodes, size_t *out_refs) {
    if (out_nodes != NULL) {
        *out_nodes = graph == NULL ? 0 : graph->nodes_len - graph->nodes_dead;
    }
    if (out_refs != NULL) {
        *out_refs = graph == NULL ? 0 : graph->refs_len - graph->refs_dead;
    }
}

const cberg_graph_node *cberg_graph_node_by_id(const cberg_graph *graph, uint64_t id) {
    if (graph == NULL) {
        return NULL;
    }
    graph_node_rec *rec = node_rec_by_id(graph, id);
    return rec == NULL ? NULL : &rec->pub;
}

/* Tombstone a file's nodes/refs without compacting (used by transactional apply). */
static void graph_tombstone_file(cberg_graph *graph, const char *path) {
    graph->revision++;
    uint64_t head = 0;
    if (cberg_strmap_get(graph->node_by_path, path, &head)) {
        for (uint32_t i = (uint32_t)head; i != 0; i = graph->nodes[i - 1].path_next) {
            graph_node_rec *rec = &graph->nodes[i - 1];
            if (!rec->dead) {
                rec->dead = 1;
                graph->nodes_dead++;
            }
        }
    }
    head = 0;
    if (cberg_strmap_get(graph->ref_by_path, path, &head)) {
        for (uint32_t i = (uint32_t)head; i != 0; i = graph->refs[i - 1].path_next) {
            graph_ref_rec *rec = &graph->refs[i - 1];
            if (!rec->dead) {
                rec->dead = 1;
                graph->refs_dead++;
            }
        }
    }
}

cberg_status cberg_graph_remove_file(cberg_graph *graph, const char *path) {
    if (graph == NULL || path == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    graph_tombstone_file(graph, path);
    graph_maybe_compact(graph);
    return CBERG_OK;
}

/*
 * Transactional apply undo: record live slot indexes for `path`, tombstone them,
 * rebuild, and on failure untombstone those indexes after killing the partial
 * rebuild. Success path never deep-copies strings (unlike a snapshot restore).
 * Compact is deferred until commit/abort so recorded indexes stay valid.
 */
typedef struct {
    uint32_t *node_idx;
    size_t node_len;
    uint32_t *ref_idx;
    size_t ref_len;
    size_t nodes_mark; /* graph->nodes_len before rebuild */
    size_t refs_mark;
} file_undo;

static void file_undo_free(file_undo *u) {
    if (u == NULL) {
        return;
    }
    free(u->node_idx);
    free(u->ref_idx);
    memset(u, 0, sizeof(*u));
}

static cberg_status file_undo_begin(cberg_graph *graph, const char *path, file_undo *u) {
    memset(u, 0, sizeof(*u));
    u->nodes_mark = graph->nodes_len;
    u->refs_mark = graph->refs_len;

    size_t n_nodes = 0;
    size_t n_refs = 0;
    uint64_t head = 0;
    if (cberg_strmap_get(graph->node_by_path, path, &head)) {
        for (uint32_t i = (uint32_t)head; i != 0; i = graph->nodes[i - 1].path_next) {
            if (!graph->nodes[i - 1].dead) {
                n_nodes++;
            }
        }
    }
    head = 0;
    if (cberg_strmap_get(graph->ref_by_path, path, &head)) {
        for (uint32_t i = (uint32_t)head; i != 0; i = graph->refs[i - 1].path_next) {
            if (!graph->refs[i - 1].dead) {
                n_refs++;
            }
        }
    }
    if (n_nodes > 0) {
        u->node_idx = malloc(n_nodes * sizeof(*u->node_idx));
        if (u->node_idx == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    if (n_refs > 0) {
        u->ref_idx = malloc(n_refs * sizeof(*u->ref_idx));
        if (u->ref_idx == NULL) {
            file_undo_free(u);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    head = 0;
    if (cberg_strmap_get(graph->node_by_path, path, &head)) {
        for (uint32_t i = (uint32_t)head; i != 0; i = graph->nodes[i - 1].path_next) {
            graph_node_rec *rec = &graph->nodes[i - 1];
            if (rec->dead) {
                continue;
            }
            u->node_idx[u->node_len++] = i - 1;
            rec->dead = 1;
            graph->nodes_dead++;
        }
    }
    head = 0;
    if (cberg_strmap_get(graph->ref_by_path, path, &head)) {
        for (uint32_t i = (uint32_t)head; i != 0; i = graph->refs[i - 1].path_next) {
            graph_ref_rec *rec = &graph->refs[i - 1];
            if (rec->dead) {
                continue;
            }
            u->ref_idx[u->ref_len++] = i - 1;
            rec->dead = 1;
            graph->refs_dead++;
        }
    }
    return CBERG_OK;
}

static void file_undo_abort(cberg_graph *graph, file_undo *u) {
    /* Kill partial rebuild slots appended after the mark (apply is exclusive).
     * graph_add_node overwrote node_by_id for any id that was re-inserted; those
     * map entries still point at the dead rebuild slots until we re-point them
     * at the revived prior indexes below. Brand-new ids (e.g. MODULE nodes from
     * ensure_module_node) are soft-cleared (value 0) so lookups miss until a
     * later insert. Name/path/ref chains keep dead heads but walkers skip dead
     * slots, so prior live entries remain reachable. */
    for (size_t i = u->nodes_mark; i < graph->nodes_len; i++) {
        graph_node_rec *rec = &graph->nodes[i];
        if (!rec->dead) {
            rec->dead = 1;
            graph->nodes_dead++;
        }
        if (rec->pub.id != 0) {
            uint64_t idx1 = 0;
            if (cberg_u64map_get(graph->node_by_id, rec->pub.id, &idx1) && idx1 == (uint64_t)i + 1) {
                /* Value 0: node_rec_by_id treats idx1==0 as missing. */
                (void)cberg_u64map_set(graph->node_by_id, rec->pub.id, 0);
            }
        }
    }
    for (size_t i = u->refs_mark; i < graph->refs_len; i++) {
        graph_ref_rec *rec = &graph->refs[i];
        if (!rec->dead) {
            rec->dead = 1;
            graph->refs_dead++;
        }
    }
    for (size_t i = 0; i < u->node_len; i++) {
        uint32_t idx = u->node_idx[i];
        graph_node_rec *rec = &graph->nodes[idx];
        if (rec->dead) {
            rec->dead = 0;
            graph->nodes_dead--;
        }
        /* Best-effort: OOM here leaves id lookup broken until compact rebuilds. */
        (void)cberg_u64map_set(graph->node_by_id, rec->pub.id, (uint64_t)idx + 1);
    }
    for (size_t i = 0; i < u->ref_len; i++) {
        graph_ref_rec *rec = &graph->refs[u->ref_idx[i]];
        if (rec->dead) {
            rec->dead = 0;
            graph->refs_dead--;
        }
    }
}

cberg_status cberg_graph_apply(cberg_graph *graph, const cberg_graph_fragment *fragment, cberg_graph_resolve_fn resolve, void *resolve_ctx) {
    if (graph == NULL || fragment == NULL || resolve == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    file_undo undo = {0};
    uint64_t *def_ids = NULL;
    cberg_status st = file_undo_begin(graph, fragment->path, &undo);
    if (st != CBERG_OK) {
        return st;
    }

    uint64_t file_id = graph_file_id(fragment->path);
    if (file_id == 0) {
        st = CBERG_ERR_OUT_OF_MEMORY;
        goto fail_restore;
    }
    cberg_graph_node file_node = {
        .id = file_id,
        .kind = CBERG_GNODE_FILE,
        .lang = fragment->lang,
        .name = path_basename(fragment->path),
        .qname = fragment->path,
        .path = fragment->path,
    };
    st = graph_add_node(graph, &file_node);
    if (st != CBERG_OK) {
        goto fail_restore;
    }

    if (fragment->defs_len > 0) {
        def_ids = calloc(fragment->defs_len, sizeof(*def_ids));
        if (def_ids == NULL) {
            st = CBERG_ERR_OUT_OF_MEMORY;
            goto fail_restore;
        }
    }
    for (size_t i = 0; i < fragment->defs_len; i++) {
        const cberg_graph_fdef *def = &fragment->defs[i];
        uint64_t id = 0;
        st = resolve(resolve_ctx, def->key, &id);
        if (st == CBERG_ERR_NOT_FOUND) {
            continue; /* def no longer in the chunk table; skip its node */
        }
        if (st != CBERG_OK) {
            goto fail_restore;
        }
        if (id == 0) {
            continue;
        }
        cberg_graph_node node = {
            .id = id,
            .kind = node_kind_from_chunk(def->kind),
            .lang = fragment->lang,
            .name = def->name,
            .qname = def->key,
            .path = fragment->path,
            .span = def->span,
        };
        st = graph_add_node(graph, &node);
        if (st != CBERG_OK) {
            goto fail_restore;
        }
        def_ids[i] = id;
    }

    for (size_t i = 0; i < fragment->refs_len; i++) {
        const cberg_graph_fref *fref = &fragment->refs[i];
        if (fref->src_def >= 0 && (size_t)fref->src_def >= fragment->defs_len) {
            continue;
        }
        if (fref->dst_def >= 0 && (size_t)fref->dst_def >= fragment->defs_len) {
            continue;
        }
        uint64_t src = fref->src_def >= 0 ? def_ids[fref->src_def] : file_id;
        if (src == 0) {
            continue; /* source def did not resolve to a live chunk */
        }
        graph_ref_rec rec = {
            .src = src,
            .path = fragment->path,
            .line = fref->line,
            .kind = fref->kind,
            .rev = fref->rev,
            .binding = fref->binding,
            .module = fref->module,
            .owner = fref->owner,
            .resolution = fref->module != NULL ? CBERG_GRES_IMPORT : CBERG_GRES_TEXTUAL,
        };
        if (fref->dst_def >= 0) {
            rec.dst = def_ids[fref->dst_def];
            if (rec.dst == 0) {
                continue;
            }
        } else if (fref->kind == CBERG_GEDGE_IMPORTS) {
            rec.name = fref->name;
            st = ensure_module_node(graph, fref->name, fragment->lang, &rec.dst);
            if (st != CBERG_OK) {
                goto fail_restore;
            }
            /* Module target until cberg_graph_resolve_imports rewrites to a FILE. */
        } else {
            rec.name = fref->name;
        }
        st = graph_add_ref(graph, &rec);
        if (st != CBERG_OK) {
            goto fail_restore;
        }
    }
    free(def_ids);
    file_undo_free(&undo);
    graph_maybe_compact(graph);
    return CBERG_OK;

fail_restore:
    free(def_ids);
    file_undo_abort(graph, &undo);
    file_undo_free(&undo);
    graph_maybe_compact(graph);
    return st;
}

/* ------------------------------------------------------------ resolution */

typedef struct graph_candidates {
    uint32_t idx[GRAPH_MAX_CANDIDATES]; /* node indexes, chain order */
    size_t count;
    float confidence;
} graph_candidates;

static int same_directory(const char *a, const char *b) {
    if (a == NULL || b == NULL)
        return 0;

    const char *slash_a = strrchr(a, '/'), *slash_b = strrchr(b, '/');
    size_t length_a = slash_a != NULL ? (size_t)(slash_a - a) : 0;
    size_t length_b = slash_b != NULL ? (size_t)(slash_b - b) : 0;
    return length_a == length_b && strncmp(a, b, length_a) == 0;
}

static int declares_member(const cberg_graph *g, const graph_node_rec *type, const char *name) {
    uint64_t head = 0;
    if (!cberg_u64map_get(g->ref_by_src, type->pub.id, &head))
        return 0;

    for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].src_next) {
        const graph_ref_rec *reference = &g->refs[i - 1];
        if (reference->dead || reference->rev || reference->kind != CBERG_GEDGE_CONTAINS)
            continue;

        const graph_node_rec *member = node_rec_by_id(g, reference->dst);
        if (member != NULL && strcmp(member->pub.name, name) == 0)
            return 1;
    }

    return 0;
}

static int same_file_base(const cberg_graph *g, const char *owner, const graph_node_rec *base, const char *member, unsigned depth) {
    if (depth == 0)
        return 0;

    uint64_t named = 0;
    if (!cberg_strmap_get(g->node_by_name, owner, &named))
        return 0;
    for (uint32_t i = (uint32_t)named; i != 0; i = g->nodes[i - 1].name_next) {
        const graph_node_rec *type = &g->nodes[i - 1];
        if (type->dead || type->pub.path == NULL || strcmp(type->pub.path, base->pub.path) != 0)
            continue;
        if (declares_member(g, type, member))
            continue;

        uint64_t head = 0;
        if (!cberg_u64map_get(g->ref_by_src, type->pub.id, &head))
            continue;
        for (uint32_t j = (uint32_t)head; j != 0; j = g->refs[j - 1].src_next) {
            const graph_ref_rec *reference = &g->refs[j - 1];
            if (reference->dead || reference->kind != CBERG_GEDGE_INHERITS || reference->name == NULL)
                continue;
            if (strcmp(reference->name, base->pub.name) == 0 ||
                same_file_base(g, reference->name, base, member, depth - 1))
                return 1;
        }
    }

    return 0;
}

static int candidate_owner_matches(const cberg_graph *g, const graph_node_rec *candidate, const char *owner) {
    uint64_t head = 0;
    int contained = 0, matches = 0;
    if (cberg_u64map_get(g->ref_by_dst, candidate->pub.id, &head)) {
        for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].dst_next) {
            const graph_ref_rec *reference = &g->refs[i - 1];
            if (reference->dead || reference->rev || reference->kind != CBERG_GEDGE_CONTAINS)
                continue;

            const graph_node_rec *parent = node_rec_by_id(g, reference->src);
            if (parent == NULL)
                continue;

            contained = 1;
            matches |= owner != NULL && (strcmp(parent->pub.name, owner) == 0 ||
                                         same_file_base(g, owner, parent, candidate->pub.name, 8));
        }
    }

    if (cberg_u64map_get(g->ref_by_src, candidate->pub.id, &head)) {
        for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].src_next) {
            const graph_ref_rec *reference = &g->refs[i - 1];
            if (reference->dead || !reference->rev || reference->kind != CBERG_GEDGE_CONTAINS)
                continue;

            contained = 1;
            matches |= owner != NULL && strcmp(reference->name, owner) == 0;
        }
    }

    return owner != NULL ? matches : !contained;
}

static const char *bound_import_path(const cberg_graph *g, const graph_ref_rec *reference) {
    if (reference->module == NULL)
        return NULL;

    uint64_t head = 0;
    if (!cberg_u64map_get(g->ref_by_src, graph_file_id(reference->path), &head))
        return NULL;

    for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].src_next) {
        const graph_ref_rec *import = &g->refs[i - 1];
        if (import->dead || import->kind != CBERG_GEDGE_IMPORTS || import->name == NULL ||
            strcmp(import->name, reference->module) != 0)
            continue;

        const graph_node_rec *target = node_rec_by_id(g, import->dst);
        if (target != NULL && target->pub.kind == CBERG_GNODE_FILE)
            return target->pub.path;
    }

    return NULL;
}

static int workspace_legacy_match(const cberg_graph *g, const graph_ref_rec *reference, const graph_node_rec *candidate) {
    const graph_node_rec *source = node_rec_by_id(g, graph_file_id(reference->path));
    if (source == NULL || source->repo == NULL || candidate->repo == NULL)
        return 0;
    if (strcmp(source->repo, candidate->repo) == 0)
        return 1;
    if (source->pub.lang != candidate->pub.lang)
        return 0;

    uint64_t head = 0;
    if (!cberg_u64map_get(g->ref_by_src, source->pub.id, &head))
        return 0;
    for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].src_next) {
        const graph_ref_rec *import = &g->refs[i - 1];
        if (import->dead || import->kind != CBERG_GEDGE_IMPORTS)
            continue;

        const graph_node_rec *file = node_rec_by_id(g, import->dst);
        if (file != NULL && file->pub.kind == CBERG_GNODE_FILE && file->pub.path != NULL &&
            candidate->pub.path != NULL && strcmp(file->pub.path, candidate->pub.path) == 0)
            return 1;
    }

    return 0;
}

static int binding_matches(const cberg_graph *g, const graph_ref_rec *reference, const graph_node_rec *candidate, const char *target_path) {
    const graph_node_rec *file = node_rec_by_id(g, graph_file_id(reference->path));
    if (file == NULL || file->pub.lang != candidate->pub.lang)
        return 0;

    switch ((cberg_graph_binding_kind)reference->binding) {
    case CBERG_BIND_LEGACY:
        return 1;
    case CBERG_BIND_UNKNOWN:
    case CBERG_BIND_LOCAL:
        return 0;
    case CBERG_BIND_PACKAGE:
        return same_directory(reference->path, candidate->pub.path) && candidate_owner_matches(g, candidate, NULL);
    case CBERG_BIND_IMPORT:
    case CBERG_BIND_MEMBER:
        if (target_path == NULL || candidate->pub.path == NULL)
            return 0;
        if (file->pub.lang == CBERG_LANG_GO) {
            if (!same_directory(target_path, candidate->pub.path))
                return 0;
        } else if (strcmp(target_path, candidate->pub.path) != 0) {
            return 0;
        }
        return candidate_owner_matches(g, candidate, reference->owner);
    default:
        /* never: serialized bindings are validated by the loader. */
        abort();
    }
}

/*
 * Textual name resolution: collect live definitions named `name` whose kind a
 * `ref_kind` reference may target. Same-file definitions shadow every other
 * candidate (confidence 0.90); otherwise all candidates share a confidence
 * scaled down by ambiguity (0.75 * min(1, 3/count)). At most
 * GRAPH_MAX_CANDIDATES are returned.
 */
static void resolve_name(const cberg_graph *g, const graph_ref_rec *reference, graph_candidates *out) {
    out->count = 0;
    out->confidence = 0.0f;
    const char *name = reference->name, *ref_path = reference->path;
    const char *target_path = reference->binding == CBERG_BIND_IMPORT ? bound_import_path(g, reference) : ref_path;
    uint32_t kinds = candidate_kind_mask(reference->kind);
    uint64_t head = 0;
    if (!cberg_strmap_get(g->node_by_name, name, &head)) {
        return;
    }
    size_t total = 0;
    int same_file = 0;
    for (uint32_t i = (uint32_t)head; i != 0; i = g->nodes[i - 1].name_next) {
        const graph_node_rec *rec = &g->nodes[i - 1];
        if (rec->dead || (kinds & CBERG_GNODE_MASK(rec->pub.kind)) == 0) {
            continue;
        }
        if (g->workspace && reference->binding == CBERG_BIND_LEGACY && !workspace_legacy_match(g, reference, rec))
            continue;
        if (reference->binding != CBERG_BIND_LEGACY && !binding_matches(g, reference, rec, target_path))
            continue;
        int local = rec->pub.path != NULL && ref_path != NULL && strcmp(rec->pub.path, ref_path) == 0;
        if (local && !same_file) {
            /* First same-file hit: discard global candidates collected so far. */
            same_file = 1;
            out->count = 0;
            total = 0;
        }
        if (same_file && !local) {
            continue;
        }
        total++;
        if (out->count < GRAPH_MAX_CANDIDATES) {
            out->idx[out->count++] = i - 1;
        }
    }
    if (total == 0) {
        return;
    }
    if (same_file) {
        out->confidence = GRAPH_CONF_SAME_FILE;
    } else {
        float penalty = GRAPH_CANDIDATE_PENALTY_CAP / (float)total;
        out->confidence = GRAPH_CONF_GLOBAL * (penalty < 1.0f ? penalty : 1.0f);
    }
}

static int candidates_contain(const graph_candidates *c, uint32_t node_index) {
    for (size_t i = 0; i < c->count; i++) {
        if (c->idx[i] == node_index) {
            return 1;
        }
    }
    return 0;
}

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

static int same_optional_string(const char *a, const char *b) {
    return a == b || (a != NULL && b != NULL && strcmp(a, b) == 0);
}

static void resolve_name_cached(const cberg_graph *g, const graph_ref_rec *reference, resolve_memo *memo, graph_candidates *out) {
    const char *name = reference->name, *ref_path = reference->path;
    uint8_t ref_kind = reference->kind;
    if (memo->valid && memo->kind == ref_kind && memo->binding == reference->binding &&
        same_optional_string(memo->module, reference->module) && same_optional_string(memo->owner, reference->owner) &&
        memo->name != NULL && name != NULL && strcmp(memo->name, name) == 0) {
        int same_path = (memo->path == ref_path) ||
                        (memo->path != NULL && ref_path != NULL && strcmp(memo->path, ref_path) == 0) ||
                        (memo->path == NULL && ref_path == NULL);
        if (same_path) {
            *out = memo->cands;
            return;
        }
    }
    resolve_name(g, reference, out);
    memo->name = name;
    memo->path = ref_path;
    memo->kind = ref_kind;
    memo->binding = reference->binding;
    memo->module = reference->module;
    memo->owner = reference->owner;
    memo->cands = *out;
    memo->valid = 1;
}

/* ------------------------------------------------------------ edge iteration */

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

#define GRAPH_CONF_IMPORT 0.95f

static int emit_ref_candidates(const cberg_graph *g, const graph_ref_rec *ref, int as_source, graph_edge_sink sink, void *ctx, resolve_memo *memo) {
    graph_candidates cands;
    resolve_name_cached(g, ref, memo, &cands);
    for (size_t c = 0; c < cands.count; c++) {
        uint64_t cand_id = g->nodes[cands.idx[c]].pub.id;
        cberg_graph_resolution res = ref->resolution != 0 ? (cberg_graph_resolution)ref->resolution : CBERG_GRES_TEXTUAL;
        cberg_graph_edge edge = as_source ? make_edge(cand_id, ref->src, ref->kind, res, cands.confidence, ref->line)
                                          : make_edge(ref->src, cand_id, ref->kind, res, cands.confidence, ref->line);
        if (sink(ctx, &edge)) {
            return 1;
        }
    }
    return 0;
}

/* All resolved edges leaving `rec`'s node. */
static int emit_edges_from(const cberg_graph *g, const graph_node_rec *rec, uint32_t mask, graph_edge_sink sink, void *ctx) {
    uint64_t id = rec->pub.id;
    resolve_memo memo = {0};

    /* DEFINES is synthesized from the path index rather than stored. */
    if (rec->pub.kind == CBERG_GNODE_FILE && (mask & CBERG_GEDGE_DEFINES) != 0) {
        uint64_t head = 0;
        if (cberg_strmap_get(g->node_by_path, rec->pub.qname, &head)) {
            for (uint32_t i = (uint32_t)head; i != 0; i = g->nodes[i - 1].path_next) {
                const graph_node_rec *sym = &g->nodes[i - 1];
                if (sym->dead || sym->pub.kind == CBERG_GNODE_FILE) {
                    continue;
                }
                cberg_graph_edge edge = make_edge(id, sym->pub.id, CBERG_GEDGE_DEFINES, CBERG_GRES_TEXTUAL, GRAPH_CONF_EXACT, sym->pub.span.start_line);
                if (sink(ctx, &edge)) {
                    return 1;
                }
            }
        }
    }

    uint64_t head = 0;
    if (cberg_u64map_get(g->ref_by_src, id, &head)) {
        for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].src_next) {
            const graph_ref_rec *ref = &g->refs[i - 1];
            if (ref->dead || ref->rev || (mask & ref->kind) == 0) {
                continue;
            }
            if (ref->dst != 0) {
                const graph_node_rec *dst = node_rec_by_id(g, ref->dst);
                if (dst == NULL) {
                    continue;
                }
                cberg_graph_resolution res =
                    ref->resolution != 0 ? (cberg_graph_resolution)ref->resolution : CBERG_GRES_TEXTUAL;
                float conf = ref->binding == CBERG_BIND_LOCAL ? GRAPH_CONF_SAME_FILE : res == CBERG_GRES_IMPORT ? GRAPH_CONF_IMPORT
                                                                                                                : GRAPH_CONF_EXACT;
                cberg_graph_edge edge = make_edge(id, ref->dst, ref->kind, res, conf, ref->line);
                if (sink(ctx, &edge)) {
                    return 1;
                }
            } else if (emit_ref_candidates(g, ref, 0, sink, ctx, &memo)) {
                return 1;
            }
        }
    }

    /* Reversed refs (e.g. Go receiver methods) name *this* node as the edge
     * source: container -> member. */
    head = 0;
    if (cberg_strmap_get(g->ref_by_name, rec->pub.name, &head)) {
        uint32_t self_index = (uint32_t)(rec - g->nodes);
        for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].name_next) {
            const graph_ref_rec *ref = &g->refs[i - 1];
            if (ref->dead || !ref->rev || (mask & ref->kind) == 0) {
                continue;
            }
            graph_candidates cands;
            resolve_name_cached(g, ref, &memo, &cands);
            if (!candidates_contain(&cands, self_index)) {
                continue;
            }
            cberg_graph_resolution res = ref->resolution != 0 ? (cberg_graph_resolution)ref->resolution : CBERG_GRES_TEXTUAL;
            cberg_graph_edge edge = make_edge(id, ref->src, ref->kind, res, cands.confidence, ref->line);
            if (sink(ctx, &edge)) {
                return 1;
            }
        }
    }
    return 0;
}

/* All resolved edges arriving at `rec`'s node. */
static int emit_edges_to(const cberg_graph *g, const graph_node_rec *rec, uint32_t mask, graph_edge_sink sink, void *ctx) {
    uint64_t id = rec->pub.id;
    resolve_memo memo = {0};

    if (rec->pub.kind != CBERG_GNODE_FILE && rec->pub.path != NULL && (mask & CBERG_GEDGE_DEFINES) != 0) {
        uint64_t fid = graph_file_id(rec->pub.path);
        if (node_rec_by_id(g, fid) != NULL) {
            cberg_graph_edge edge = make_edge(fid, id, CBERG_GEDGE_DEFINES, CBERG_GRES_TEXTUAL, GRAPH_CONF_EXACT, rec->pub.span.start_line);
            if (sink(ctx, &edge)) {
                return 1;
            }
        }
    }

    uint64_t head = 0;
    if (cberg_u64map_get(g->ref_by_dst, id, &head)) {
        for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].dst_next) {
            const graph_ref_rec *ref = &g->refs[i - 1];
            if (ref->dead || ref->rev || (mask & ref->kind) == 0 || node_rec_by_id(g, ref->src) == NULL) {
                continue;
            }
            cberg_graph_resolution res =
                ref->resolution != 0 ? (cberg_graph_resolution)ref->resolution : CBERG_GRES_TEXTUAL;
            float conf = ref->binding == CBERG_BIND_LOCAL ? GRAPH_CONF_SAME_FILE : res == CBERG_GRES_IMPORT ? GRAPH_CONF_IMPORT
                                                                                                            : GRAPH_CONF_EXACT;
            cberg_graph_edge edge = make_edge(ref->src, id, ref->kind, res, conf, ref->line);
            if (sink(ctx, &edge)) {
                return 1;
            }
        }
    }

    /* Named refs that resolve to this node: callers, subtypes, … */
    head = 0;
    if (cberg_strmap_get(g->ref_by_name, rec->pub.name, &head)) {
        uint32_t self_index = (uint32_t)(rec - g->nodes);
        for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].name_next) {
            const graph_ref_rec *ref = &g->refs[i - 1];
            if (ref->dead || ref->rev || (mask & ref->kind) == 0 || node_rec_by_id(g, ref->src) == NULL) {
                continue;
            }
            graph_candidates cands;
            resolve_name_cached(g, ref, &memo, &cands);
            if (!candidates_contain(&cands, self_index)) {
                continue;
            }
            cberg_graph_resolution res = ref->resolution != 0 ? (cberg_graph_resolution)ref->resolution : CBERG_GRES_TEXTUAL;
            cberg_graph_edge edge = make_edge(ref->src, id, ref->kind, res, cands.confidence, ref->line);
            if (sink(ctx, &edge)) {
                return 1;
            }
        }
    }

    /* Reversed refs on this node point back in: member <- container. */
    head = 0;
    if (cberg_u64map_get(g->ref_by_src, id, &head)) {
        for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].src_next) {
            const graph_ref_rec *ref = &g->refs[i - 1];
            if (ref->dead || !ref->rev || (mask & ref->kind) == 0) {
                continue;
            }
            if (emit_ref_candidates(g, ref, 1, sink, ctx, &memo)) {
                return 1;
            }
        }
    }
    return 0;
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
    const graph_node_rec *rec = node_rec_by_id(graph, id);
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
            if (rec->dead || (kind_mask != 0 && (kind_mask & CBERG_GNODE_MASK(rec->pub.kind)) == 0)) {
                continue;
            }
            if (graph->scope != NULL && (rec->repo == NULL || strcmp(rec->repo, graph->scope) != 0))
                continue;
            if (prefix_len > 0 && !path_matches_prefix(cberg_graph_source_path(graph, &rec->pub), path_prefix, prefix_len)) {
                continue;
            }
            out_nodes[(*out_count)++] = &rec->pub;
        }
        return CBERG_OK;
    }

    for (size_t i = 0; i < graph->nodes_len && *out_count < cap; i++) {
        const graph_node_rec *rec = &graph->nodes[i];
        if (rec->dead || (kind_mask != 0 && (kind_mask & CBERG_GNODE_MASK(rec->pub.kind)) == 0)) {
            continue;
        }
        if (graph->scope != NULL && (rec->repo == NULL || strcmp(rec->repo, graph->scope) != 0))
            continue;
        if (prefix_len > 0 && !path_matches_prefix(cberg_graph_source_path(graph, &rec->pub), path_prefix, prefix_len)) {
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
    if (node_rec_by_id(graph, start_id) == NULL) {
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
            const graph_node_rec *rec = node_rec_by_id(graph, frontier[i]);
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

/* ------------------------------------------------------------- persistence */

/* Snapshot format: magic + version guard, live node and ref counts, then the
 * records. Incompatible or truncated files load as NOT_FOUND (cold rebuild),
 * matching the chunk-table contract. */
#define CBERG_GRAPH_MAGIC "CBG1"
/* v4 invalidates bindings extracted before lexical shadowing fixes. */
#define CBERG_GRAPH_VERSION 4u

cberg_status cberg_graph_save(const cberg_graph *graph, const char *path) {
    if (graph == NULL || path == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char tmp[4096];
    FILE *f = NULL;
    cberg_status st = cberg_atomic_begin(path, tmp, sizeof tmp, &f);
    if (st != CBERG_OK) {
        return st;
    }
    size_t live_nodes = 0;
    size_t live_refs = 0;
    cberg_graph_counts(graph, &live_nodes, &live_refs);
    if (cberg_bin_w_bytes(f, CBERG_GRAPH_MAGIC, 4) != CBERG_OK || cberg_bin_w_u32(f, CBERG_GRAPH_VERSION) != CBERG_OK ||
        cberg_bin_w_u64(f, live_nodes) != CBERG_OK || cberg_bin_w_u64(f, live_refs) != CBERG_OK) {
        st = CBERG_ERR_IO;
        goto fail;
    }
    for (size_t i = 0; i < graph->nodes_len; i++) {
        const graph_node_rec *rec = &graph->nodes[i];
        if (rec->dead) {
            continue;
        }
        if (cberg_bin_w_u64(f, rec->pub.id) != CBERG_OK || cberg_bin_w_u32(f, (uint32_t)rec->pub.kind) != CBERG_OK ||
            cberg_bin_w_u32(f, (uint32_t)rec->pub.lang) != CBERG_OK ||
            cberg_bin_w_u32(f, rec->pub.span.start_byte) != CBERG_OK || cberg_bin_w_u32(f, rec->pub.span.end_byte) != CBERG_OK ||
            cberg_bin_w_u32(f, rec->pub.span.start_line) != CBERG_OK || cberg_bin_w_u32(f, rec->pub.span.end_line) != CBERG_OK ||
            cberg_bin_w_str(f, rec->pub.name) != CBERG_OK || cberg_bin_w_str(f, rec->pub.qname) != CBERG_OK ||
            cberg_bin_w_str(f, rec->pub.path) != CBERG_OK) {
            st = CBERG_ERR_IO;
            goto fail;
        }
    }
    for (size_t i = 0; i < graph->refs_len; i++) {
        const graph_ref_rec *rec = &graph->refs[i];
        if (rec->dead) {
            continue;
        }
        if (cberg_bin_w_u64(f, rec->src) != CBERG_OK || cberg_bin_w_u64(f, rec->dst) != CBERG_OK ||
            cberg_bin_w_u32(f, rec->line) != CBERG_OK ||
            cberg_bin_w_u32(f, ((uint32_t)rec->binding << 24) | ((uint32_t)rec->resolution << 16) | ((uint32_t)rec->rev << 8) | rec->kind) != CBERG_OK ||
            cberg_bin_w_str(f, rec->name) != CBERG_OK || cberg_bin_w_str(f, rec->path) != CBERG_OK ||
            cberg_bin_w_str(f, rec->module) != CBERG_OK || cberg_bin_w_str(f, rec->owner) != CBERG_OK) {
            st = CBERG_ERR_IO;
            goto fail;
        }
    }
    st = cberg_atomic_commit(&f, tmp, path);
    if (st != CBERG_OK) {
        return st;
    }

    return CBERG_OK;

fail:
    cberg_atomic_abort(f, tmp);
    return st;
}

cberg_status cberg_graph_load(const char *path, cberg_graph **out_graph) {
    if (path == NULL || out_graph == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_graph = NULL;
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }

    char magic[4];
    uint32_t version = 0;
    uint64_t node_count = 0;
    uint64_t ref_count = 0;
    if (cberg_bin_r_exact(f, magic, 4) != CBERG_OK || memcmp(magic, CBERG_GRAPH_MAGIC, 4) != 0 ||
        cberg_bin_r_u32(f, &version) != CBERG_OK || version != CBERG_GRAPH_VERSION ||
        cberg_bin_r_u64(f, &node_count) != CBERG_OK || cberg_bin_r_u64(f, &ref_count) != CBERG_OK) {
        fclose(f);
        return CBERG_ERR_NOT_FOUND;
    }

    cberg_graph *g = NULL;
    cberg_status st = cberg_graph_new(&g);
    if (st != CBERG_OK) {
        fclose(f);
        return st;
    }

    for (uint64_t i = 0; i < node_count && st == CBERG_OK; i++) {
        cberg_graph_node node = {0};
        uint32_t kind = 0;
        uint32_t lang = 0;
        char *name = NULL;
        char *qname = NULL;
        char *npath = NULL;
        if (cberg_bin_r_u64(f, &node.id) != CBERG_OK || cberg_bin_r_u32(f, &kind) != CBERG_OK ||
            cberg_bin_r_u32(f, &lang) != CBERG_OK || cberg_bin_r_u32(f, &node.span.start_byte) != CBERG_OK ||
            cberg_bin_r_u32(f, &node.span.end_byte) != CBERG_OK || cberg_bin_r_u32(f, &node.span.start_line) != CBERG_OK ||
            cberg_bin_r_u32(f, &node.span.end_line) != CBERG_OK || cberg_bin_r_str(f, &name) != CBERG_OK ||
            cberg_bin_r_str(f, &qname) != CBERG_OK || cberg_bin_r_str(f, &npath) != CBERG_OK || name == NULL ||
            qname == NULL || kind > CBERG_GNODE_MODULE) {
            free(name);
            free(qname);
            free(npath);
            st = CBERG_ERR_NOT_FOUND; /* truncated/corrupt -> cold rebuild */
            break;
        }
        node.kind = (cberg_graph_node_kind)kind;
        node.lang = (cberg_language)lang;
        node.name = name;
        node.qname = qname;
        node.path = npath;
        st = graph_add_node(g, &node);
        free(name);
        free(qname);
        free(npath);
    }

    for (uint64_t i = 0; i < ref_count && st == CBERG_OK; i++) {
        graph_ref_rec rec = {0};
        uint32_t kind_rev = 0;
        char *name = NULL;
        char *rpath = NULL;
        char *module = NULL;
        char *owner = NULL;
        if (cberg_bin_r_u64(f, &rec.src) != CBERG_OK || cberg_bin_r_u64(f, &rec.dst) != CBERG_OK ||
            cberg_bin_r_u32(f, &rec.line) != CBERG_OK || cberg_bin_r_u32(f, &kind_rev) != CBERG_OK ||
            cberg_bin_r_str(f, &name) != CBERG_OK || cberg_bin_r_str(f, &rpath) != CBERG_OK || rpath == NULL ||
            cberg_bin_r_str(f, &module) != CBERG_OK || cberg_bin_r_str(f, &owner) != CBERG_OK ||
            (kind_rev >> 24) > CBERG_BIND_UNKNOWN) {
            free(name);
            free(rpath);
            free(module);
            free(owner);
            st = CBERG_ERR_NOT_FOUND;
            break;
        }
        rec.kind = (uint8_t)(kind_rev & 0xFFu);
        rec.rev = (uint8_t)((kind_rev >> 8) & 0x1u);
        rec.resolution = (uint8_t)((kind_rev >> 16) & 0xFFu);
        rec.binding = (uint8_t)(kind_rev >> 24);
        rec.name = name;
        rec.path = rpath;
        rec.module = module;
        rec.owner = owner;
        st = graph_add_ref(g, &rec);
        free(name);
        free(rpath);
        free(module);
        free(owner);
    }
    fclose(f);
    if (st != CBERG_OK) {
        cberg_graph_free(g);
        return st;
    }
    *out_graph = g;
    return CBERG_OK;
}

/* Restore original module spellings before rebuilding the import cache, so
 * unchanged importers can follow moved or deleted target files. */
cberg_status cberg_graph_reset_imports(cberg_graph *graph) {
    size_t count = graph->refs_len;
    cberg_status status = CBERG_OK;
    for (size_t i = 0; i < count && status == CBERG_OK; i++) {
        graph_ref_rec original = graph->refs[i];
        if (original.dead || original.kind != CBERG_GEDGE_IMPORTS ||
            original.resolution != CBERG_GRES_IMPORT || original.name == NULL)
            continue;

        const graph_node_rec *source = node_rec_by_id(graph, original.src);
        if (source == NULL)
            continue;

        status = ensure_module_node(graph, original.name, source->pub.lang, &original.dst);
        if (status != CBERG_OK)
            break;

        original.resolution = CBERG_GRES_TEXTUAL;
        status = graph_add_ref(graph, &original);
        if (status == CBERG_OK) {
            graph->refs[i].dead = 1;
            graph->refs_dead++;
        }
    }

    graph_maybe_compact(graph);
    return status;
}

/* Replace an import only after its new reference has been stored successfully. */
cberg_status cberg_graph_rewrite_import(cberg_graph *graph, uint64_t src_file_id, uint64_t old_dst, uint64_t new_dst, const char *new_name) {
    if (graph == NULL || src_file_id == 0 || new_dst == 0) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    uint64_t head = 0;
    if (!cberg_u64map_get(graph->ref_by_src, src_file_id, &head)) {
        return CBERG_ERR_NOT_FOUND;
    }
    uint32_t replaced = 0;
    const char *path = NULL;
    uint32_t line = 0;
    const char *spelling = new_name;
    for (uint32_t i = (uint32_t)head; i != 0; i = graph->refs[i - 1].src_next) {
        graph_ref_rec *ref = &graph->refs[i - 1];
        if (ref->dead || ref->kind != CBERG_GEDGE_IMPORTS || ref->dst != old_dst) {
            continue;
        }
        path = ref->path;
        line = ref->line;
        if (ref->name != NULL)
            spelling = ref->name;
        replaced = i;
        break;
    }
    if (replaced == 0 || path == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    graph_ref_rec rec = {
        .src = src_file_id,
        .dst = new_dst,
        .path = path,
        .line = line,
        .kind = CBERG_GEDGE_IMPORTS,
        .resolution = (uint8_t)CBERG_GRES_IMPORT,
        .name = spelling,
    };
    cberg_status st = graph_add_ref(graph, &rec);
    if (st == CBERG_OK) {
        graph->refs[replaced - 1].dead = 1;
        graph->refs_dead++;
    }

    graph_maybe_compact(graph);
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
        const graph_node_rec *src = node_rec_by_id(graph, ref->src);
        if (src == NULL) {
            continue;
        }
        uint32_t src_idx = (uint32_t)(src - graph->nodes);
        if (ref->dst != 0) {
            const graph_node_rec *dst = node_rec_by_id(graph, ref->dst);
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
        resolve_name_cached(graph, ref, &memo, &cands);
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

/* ---------------------------------------------- private workspace queries */

uint64_t cberg_graph_revision(const cberg_graph *graph) {
    return graph != NULL ? graph->revision : 0;
}

const char *cberg_graph_source_repo(const cberg_graph *graph, uint64_t id) {
    const graph_node_rec *node = node_rec_by_id(graph, id);
    return node != NULL ? node->repo : NULL;
}

const char *cberg_graph_source_path(const cberg_graph *graph, const cberg_graph_node *node) {
    if (node == NULL || node->path == NULL)
        return NULL;
    if (cberg_graph_source_repo(graph, node->id) == NULL)
        return node->path;

    const char *slash = strchr(node->path, '/');
    return slash != NULL ? slash + 1 : node->path;
}

uint64_t cberg_graph_source_id(const cberg_graph *graph, uint64_t id) {
    const graph_node_rec *node = node_rec_by_id(graph, id);
    return node != NULL && node->repo != NULL ? node->native_id : id;
}

uint64_t cberg_graph_workspace_id(const cberg_graph *graph, const char *repo, uint64_t native_id) {
    for (size_t i = 0; i < graph->nodes_len; i++) {
        const graph_node_rec *node = &graph->nodes[i];
        if (!node->dead && node->repo != NULL && node->native_id == native_id &&
            repo != NULL && strcmp(node->repo, repo) == 0)
            return node->pub.id;
    }

    return 0;
}

void cberg_graph_workspace_scope(cberg_graph *graph, const char *repo) {
    graph->scope = repo != NULL && repo[0] != '\0' ? repo : NULL;
}

cberg_status cberg_graph_link_import(cberg_graph *graph, uint64_t source_file, uint64_t module, const char *target_file) {
    const graph_node_rec *target = node_rec_by_id(graph, graph_file_id(target_file));
    if (target == NULL || target->pub.kind != CBERG_GNODE_FILE)
        return CBERG_ERR_NOT_FOUND;
    return cberg_graph_rewrite_import(graph, source_file, module, target->pub.id, NULL);
}

static cberg_status workspace_copy_nodes(cberg_graph *out, const cberg_graph *source, const char *repo, size_t ordinal, cberg_u64map *ids) {
    for (size_t i = 0; i < source->nodes_len; i++) {
        const graph_node_rec *original = &source->nodes[i];
        if (original->dead)
            continue;

        cberg_graph_node node = original->pub;
        {
            char path[4096], symbol[128];
            if (node.kind == CBERG_GNODE_MODULE) {
                path[0] = '\0';
            } else {
                int length = snprintf(path, sizeof path, "%zu/%s", ordinal, node.path);
                if (length < 0 || (size_t)length >= sizeof path)
                    return CBERG_ERR_INVALID_ARGUMENT;
            }
            snprintf(symbol, sizeof symbol, "%zu:%llu", ordinal, (unsigned long long)node.id);
            node.id = node.kind == CBERG_GNODE_FILE ? graph_file_id(path) : graph_tagged_id('S', symbol);
            if (node_rec_by_id(out, node.id) != NULL)
                return CBERG_ERR_INVALID_ARGUMENT;
            node.path = node.kind == CBERG_GNODE_MODULE ? NULL : path;
            cberg_status status = graph_add_node(out, &node);
            if (status != CBERG_OK)
                return status;

            graph_node_rec *copy = &out->nodes[out->nodes_len - 1];
            copy->repo = cberg_arena_strdup(out->arena, repo);
            copy->native_id = original->pub.id;
            if (copy->repo == NULL)
                return CBERG_ERR_OUT_OF_MEMORY;
        }

        cberg_status status = cberg_u64map_set(ids, original->pub.id, node.id);
        if (status != CBERG_OK)
            return status;
    }

    return CBERG_OK;
}

cberg_status cberg_graph_copy_repository(cberg_graph *out, const cberg_graph *source, const char *repo, size_t ordinal) {
    if (out == NULL || source == NULL || repo == NULL)
        return CBERG_ERR_INVALID_ARGUMENT;
    cberg_u64map *ids = cberg_u64map_new(source->nodes_len + 1);
    if (ids == NULL)
        return CBERG_ERR_OUT_OF_MEMORY;

    out->workspace = 1;
    cberg_status status = workspace_copy_nodes(out, source, repo, ordinal, ids);
    for (size_t i = 0; i < source->refs_len && status == CBERG_OK; i++) {
        graph_ref_rec reference = source->refs[i];
        if (reference.dead || !cberg_u64map_get(ids, reference.src, &reference.src))
            continue;

        char path[4096];
        int length = snprintf(path, sizeof path, "%zu/%s", ordinal, reference.path);
        if (length < 0 || (size_t)length >= sizeof path) {
            status = CBERG_ERR_INVALID_ARGUMENT;
            break;
        }
        reference.path = path;
        if (reference.dst != 0 && !cberg_u64map_get(ids, reference.dst, &reference.dst)) {
            continue;
        }
        if (status == CBERG_OK)
            status = graph_add_ref(out, &reference);
    }

    cberg_u64map_free(ids);
    return status;
}
