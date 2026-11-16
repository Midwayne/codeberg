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
#include "graph_store.h"

#include <stdlib.h>
#include <string.h>

#include "grow.h"

/* ---------------------------------------------------------------- helpers */

uint64_t graph_tagged_id(char tag, const char *s) {
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

uint64_t graph_file_id(const char *path) {
    return graph_tagged_id('F', path);
}

static uint64_t graph_module_id(const char *name) {
    return graph_tagged_id('M', name);
}

graph_node_rec *graph_node_rec_by_id(const cberg_graph *g, uint64_t id) {
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
cberg_status graph_add_node(cberg_graph *g, const cberg_graph_node *pub) {
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

/* Makes room for one more ref record. */
static cberg_status refs_reserve_one(cberg_graph *g) {
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
    return CBERG_OK;
}

/* Copies tpl into rec, duplicating its strings into the graph arena. */
static cberg_status ref_copy(cberg_graph *g, const graph_ref_rec *tpl, graph_ref_rec *rec) {
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
    return CBERG_OK;
}

cberg_status graph_add_ref(cberg_graph *g, const graph_ref_rec *tpl) {
    cberg_status st = refs_reserve_one(g);
    graph_ref_rec *rec = st == CBERG_OK ? &g->refs[g->refs_len] : NULL;
    if (st == CBERG_OK) {
        st = ref_copy(g, tpl, rec);
    }
    if (st != CBERG_OK) {
        return st;
    }

    uint32_t index = (uint32_t)g->refs_len;
    st = chain_push_u64(g->ref_by_src, rec->src, index, &rec->src_next);
    if (st == CBERG_OK && rec->dst != 0) {
        st = chain_push_u64(g->ref_by_dst, rec->dst, index, &rec->dst_next);
    }
    if (st == CBERG_OK && rec->name != NULL) {
        st = chain_push_str(g->ref_by_name, rec->name, index, &rec->name_next);
    }
    if (st == CBERG_OK) {
        st = chain_push_str(g->ref_by_path, rec->path, index, &rec->path_next);
    }

    /* A half-indexed record stays, tombstoned, so its chain links stay valid. */
    g->refs_len++;
    g->revision++;
    if (st != CBERG_OK) {
        rec->dead = 1;
        g->refs_dead++;
    }
    return st;
}

/* Get-or-create the module node an import points at. */
cberg_status graph_ensure_module_node(cberg_graph *g, const char *name, cberg_language lang, uint64_t *out_id) {
    uint64_t id = graph_module_id(name);
    if (id == 0) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    if (graph_node_rec_by_id(g, id) == NULL) {
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

static int module_has_importer(const cberg_graph *g, uint64_t module_id) {
    uint64_t head = 0;
    if (!cberg_u64map_get(g->ref_by_dst, module_id, &head)) {
        return 0;
    }
    for (uint32_t i = (uint32_t)head; i != 0; i = g->refs[i - 1].dst_next) {
        const graph_ref_rec *ref = &g->refs[i - 1];
        if (!ref->dead && ref->kind == CBERG_GEDGE_IMPORTS && graph_node_rec_by_id(g, ref->src) != NULL) {
            return 1;
        }
    }
    return 0;
}

/*
 * Tombstoned slots (and their arena strings) accumulate as watched files
 * churn; once they outnumber the live entries, rebuild the store from the
 * live set. The new store is built completely before the old one is torn
 * down, so failure leaves the graph untouched.
 */
/* Copies live nodes into fresh, dropping orphan MODULE nodes that no live
 * IMPORTS ref points at. */
static cberg_status compact_nodes(const cberg_graph *g, cberg_graph *fresh) {
    cberg_status st = CBERG_OK;
    for (size_t i = 0; i < g->nodes_len && st == CBERG_OK; i++) {
        const graph_node_rec *rec = &g->nodes[i];
        if (rec->dead || (rec->pub.kind == CBERG_GNODE_MODULE && !module_has_importer(g, rec->pub.id))) {
            continue;
        }

        st = graph_add_node(fresh, &rec->pub);
        if (st == CBERG_OK && rec->repo != NULL) {
            graph_node_rec *copy = &fresh->nodes[fresh->nodes_len - 1];
            copy->repo = cberg_arena_strdup(fresh->arena, rec->repo);
            copy->native_id = rec->native_id;
            st = copy->repo != NULL ? CBERG_OK : CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    return st;
}

/* Copies live refs into fresh, skipping refs whose endpoints were dropped. */
static cberg_status compact_refs(const cberg_graph *g, cberg_graph *fresh) {
    cberg_status st = CBERG_OK;
    for (size_t i = 0; i < g->refs_len && st == CBERG_OK; i++) {
        const graph_ref_rec *ref = &g->refs[i];
        if (ref->dead || graph_node_rec_by_id(fresh, ref->src) == NULL) {
            continue;
        }
        if (ref->dst != 0 && graph_node_rec_by_id(fresh, ref->dst) == NULL) {
            continue;
        }
        st = graph_add_ref(fresh, ref);
    }
    return st;
}

/* Frees a graph's storage but not the struct itself. */
static void graph_free_storage(cberg_graph *g) {
    cberg_arena_free(g->arena);
    free(g->nodes);
    free(g->refs);
    cberg_u64map_free(g->node_by_id);
    cberg_strmap_free(g->node_by_name);
    cberg_strmap_free(g->node_by_path);
    cberg_u64map_free(g->ref_by_src);
    cberg_u64map_free(g->ref_by_dst);
    cberg_strmap_free(g->ref_by_name);
    cberg_strmap_free(g->ref_by_path);
}

static cberg_status graph_compact(cberg_graph *g) {
    cberg_graph *fresh = NULL;
    cberg_status st = cberg_graph_new(&fresh);
    if (st == CBERG_OK) {
        st = compact_nodes(g, fresh);
    }
    if (st == CBERG_OK) {
        st = compact_refs(g, fresh);
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
    graph_free_storage(&old);
    return CBERG_OK;
}

void graph_maybe_compact(cberg_graph *g) {
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
    graph_free_storage(graph);
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
    graph_node_rec *rec = graph_node_rec_by_id(graph, id);
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
