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
    uint32_t name_next;   /* +1 encoded chain over same-name nodes; 0 = end */
    uint32_t path_next;
    uint8_t dead;
} graph_node_rec;

typedef struct graph_ref_rec {
    uint64_t src;
    uint64_t dst;     /* pre-resolved target id, or 0 = resolve `name` */
    const char *name; /* arena; NULL when dst != 0 */
    const char *path; /* arena; owning file (removal unit) */
    uint32_t line;
    uint8_t kind; /* one cberg_graph_edge_kind bit */
    uint8_t rev;  /* reversed: resolved edge is (candidate -> src) */
    uint8_t resolution; /* cberg_graph_resolution; persisted from v2 */
    uint8_t dead;
    uint32_t name_next;
    uint32_t src_next;
    uint32_t dst_next;
    uint32_t path_next;
} graph_ref_rec;

struct cberg_graph {
    cberg_arena *arena;
    graph_node_rec *nodes;
    size_t nodes_len, nodes_cap, nodes_dead;
    graph_ref_rec *refs;
    size_t refs_len, refs_cap, refs_dead;
    cberg_u64map *node_by_id;  /* id -> node index+1 */
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
    rec->name = tpl->name != NULL ? cberg_arena_strdup(g->arena, tpl->name) : NULL;
    rec->path = cberg_arena_strdup(g->arena, tpl->path);
    if (rec->path == NULL || (tpl->name != NULL && rec->name == NULL)) {
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

cberg_status cberg_graph_remove_file(cberg_graph *graph, const char *path) {
    if (graph == NULL || path == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
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
    graph_maybe_compact(graph);
    return CBERG_OK;
}

cberg_status cberg_graph_apply(cberg_graph *graph, const cberg_graph_fragment *fragment, cberg_graph_resolve_fn resolve, void *resolve_ctx) {
    if (graph == NULL || fragment == NULL || resolve == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_status st = cberg_graph_remove_file(graph, fragment->path);
    if (st != CBERG_OK) {
        return st;
    }

    uint64_t file_id = graph_file_id(fragment->path);
    if (file_id == 0) {
        return CBERG_ERR_OUT_OF_MEMORY;
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
        return st;
    }

    uint64_t *def_ids = NULL;
    if (fragment->defs_len > 0) {
        def_ids = calloc(fragment->defs_len, sizeof(*def_ids));
        if (def_ids == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
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
            goto done;
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
            goto done;
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
        };
        if (fref->dst_def >= 0) {
            rec.dst = def_ids[fref->dst_def];
            if (rec.dst == 0) {
                continue;
            }
        } else if (fref->kind == CBERG_GEDGE_IMPORTS) {
            st = ensure_module_node(graph, fref->name, fragment->lang, &rec.dst);
            if (st != CBERG_OK) {
                goto done;
            }
            /* Module target until cberg_graph_resolve_imports rewrites to a FILE. */
        } else {
            rec.name = fref->name;
        }
        st = graph_add_ref(graph, &rec);
        if (st != CBERG_OK) {
            goto done;
        }
    }
    st = CBERG_OK;
    graph_maybe_compact(graph);

done:
    free(def_ids);
    return st;
}

/* ------------------------------------------------------------ resolution */

typedef struct graph_candidates {
    uint32_t idx[GRAPH_MAX_CANDIDATES]; /* node indexes, chain order */
    size_t count;
    float confidence;
} graph_candidates;

/*
 * Textual name resolution: collect live definitions named `name` whose kind a
 * `ref_kind` reference may target. Same-file definitions shadow every other
 * candidate (confidence 0.90); otherwise all candidates share a confidence
 * scaled down by ambiguity (0.75 * min(1, 3/count)). At most
 * GRAPH_MAX_CANDIDATES are returned.
 */
static void resolve_name(const cberg_graph *g, const char *name, const char *ref_path, uint8_t ref_kind, graph_candidates *out) {
    out->count = 0;
    out->confidence = 0.0f;
    uint32_t kinds = candidate_kind_mask(ref_kind);
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
    graph_candidates cands;
} resolve_memo;

static void resolve_name_cached(const cberg_graph *g, const char *name, const char *ref_path, uint8_t ref_kind, resolve_memo *memo,
                                graph_candidates *out) {
    if (memo->valid && memo->kind == ref_kind && memo->name != NULL && name != NULL && strcmp(memo->name, name) == 0) {
        int same_path = (memo->path == ref_path) ||
                        (memo->path != NULL && ref_path != NULL && strcmp(memo->path, ref_path) == 0) ||
                        (memo->path == NULL && ref_path == NULL);
        if (same_path) {
            *out = memo->cands;
            return;
        }
    }
    resolve_name(g, name, ref_path, ref_kind, out);
    memo->name = name;
    memo->path = ref_path;
    memo->kind = ref_kind;
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

static int emit_ref_candidates(const cberg_graph *g, const graph_ref_rec *ref, int as_source, graph_edge_sink sink, void *ctx,
                               resolve_memo *memo) {
    graph_candidates cands;
    resolve_name_cached(g, ref->name, ref->path, ref->kind, memo, &cands);
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
                float conf = res == CBERG_GRES_IMPORT ? GRAPH_CONF_IMPORT : GRAPH_CONF_EXACT;
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
            resolve_name_cached(g, ref->name, ref->path, ref->kind, &memo, &cands);
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
            float conf = res == CBERG_GRES_IMPORT ? GRAPH_CONF_IMPORT : GRAPH_CONF_EXACT;
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
            resolve_name_cached(g, ref->name, ref->path, ref->kind, &memo, &cands);
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
            if (prefix_len > 0 && (rec->pub.path == NULL || strncmp(rec->pub.path, path_prefix, prefix_len) != 0)) {
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
        if (prefix_len > 0 && (rec->pub.path == NULL || strncmp(rec->pub.path, path_prefix, prefix_len) != 0)) {
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
#define CBERG_GRAPH_VERSION 1u

cberg_status cberg_graph_save(const cberg_graph *graph, const char *path) {
    if (graph == NULL || path == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char tmp[4096];
    int n = snprintf(tmp, sizeof tmp, "%s.tmp", path);
    if (n < 0 || (size_t)n >= sizeof tmp) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    FILE *f = fopen(tmp, "wb");
    if (f == NULL) {
        return CBERG_ERR_IO;
    }
    cberg_status st = CBERG_OK;
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
            cberg_bin_w_u32(f, ((uint32_t)rec->resolution << 16) | ((uint32_t)rec->rev << 8) | rec->kind) != CBERG_OK ||
            cberg_bin_w_str(f, rec->name) != CBERG_OK || cberg_bin_w_str(f, rec->path) != CBERG_OK) {
            st = CBERG_ERR_IO;
            goto fail;
        }
    }
    if (fflush(f) != 0) {
        st = CBERG_ERR_IO;
        goto fail;
    }
    if (fclose(f) != 0) {
        f = NULL;
        st = CBERG_ERR_IO;
        goto fail;
    }
    if (rename(tmp, path) != 0) {
        st = CBERG_ERR_IO;
        remove(tmp);
        return st;
    }
    return CBERG_OK;

fail:
    if (f != NULL) {
        fclose(f);
    }
    remove(tmp);
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
        if (cberg_bin_r_u64(f, &rec.src) != CBERG_OK || cberg_bin_r_u64(f, &rec.dst) != CBERG_OK ||
            cberg_bin_r_u32(f, &rec.line) != CBERG_OK || cberg_bin_r_u32(f, &kind_rev) != CBERG_OK ||
            cberg_bin_r_str(f, &name) != CBERG_OK || cberg_bin_r_str(f, &rpath) != CBERG_OK || rpath == NULL) {
            free(name);
            free(rpath);
            st = CBERG_ERR_NOT_FOUND;
            break;
        }
        rec.kind = (uint8_t)(kind_rev & 0xFFu);
        rec.rev = (uint8_t)((kind_rev >> 8) & 0x1u);
        rec.resolution = (uint8_t)((kind_rev >> 16) & 0xFFu);
        rec.name = name;
        rec.path = rpath;
        st = graph_add_ref(g, &rec);
        free(name);
        free(rpath);
    }
    fclose(f);
    if (st != CBERG_OK) {
        cberg_graph_free(g);
        return st;
    }
    *out_graph = g;
    return CBERG_OK;
}

/* Rewrite one IMPORTS edge from a file onto a resolved FILE node. Used by
 * cberg_graph_resolve_imports (resolve_pkg.c). Marks the old MODULE-targeting
 * ref dead and inserts a new import-resolved ref. */
cberg_status cberg_graph_rewrite_import(cberg_graph *graph, uint64_t src_file_id, uint64_t old_dst, uint64_t new_dst, const char *new_name) {
    if (graph == NULL || src_file_id == 0 || new_dst == 0) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    uint64_t head = 0;
    if (!cberg_u64map_get(graph->ref_by_src, src_file_id, &head)) {
        return CBERG_ERR_NOT_FOUND;
    }
    int found = 0;
    const char *path = NULL;
    uint32_t line = 0;
    for (uint32_t i = (uint32_t)head; i != 0; i = graph->refs[i - 1].src_next) {
        graph_ref_rec *ref = &graph->refs[i - 1];
        if (ref->dead || ref->kind != CBERG_GEDGE_IMPORTS || ref->dst != old_dst) {
            continue;
        }
        path = ref->path;
        line = ref->line;
        ref->dead = 1;
        graph->refs_dead++;
        found = 1;
        break;
    }
    if (!found || path == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    graph_ref_rec rec = {
        .src = src_file_id,
        .dst = new_dst,
        .path = path,
        .line = line,
        .kind = CBERG_GEDGE_IMPORTS,
        .resolution = (uint8_t)CBERG_GRES_IMPORT,
        .name = new_name,
    };
    cberg_status st = graph_add_ref(graph, &rec);
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
        resolve_name_cached(graph, ref->name, ref->path, ref->kind, &memo, &cands);
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
