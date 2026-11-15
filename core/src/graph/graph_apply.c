/* Graph mutation: applying one file's fragment, and rewriting its imports. */
#include "graph_store.h"

#include <stdlib.h>
#include <string.h>

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
     * graph_ensure_module_node) are soft-cleared (value 0) so lookups miss until a
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
                /* Value 0: graph_node_rec_by_id treats idx1==0 as missing. */
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
            st = graph_ensure_module_node(graph, fref->name, fragment->lang, &rec.dst);
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

        const graph_node_rec *source = graph_node_rec_by_id(graph, original.src);
        if (source == NULL)
            continue;

        status = graph_ensure_module_node(graph, original.name, source->pub.lang, &original.dst);
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
