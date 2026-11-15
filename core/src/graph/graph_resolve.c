/* Query-time name resolution: which definitions a reference may mean. */
#include "graph_store.h"

#include <stdlib.h>
#include <string.h>

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

        const graph_node_rec *member = graph_node_rec_by_id(g, reference->dst);
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

            const graph_node_rec *parent = graph_node_rec_by_id(g, reference->src);
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

        const graph_node_rec *target = graph_node_rec_by_id(g, import->dst);
        if (target != NULL && target->pub.kind == CBERG_GNODE_FILE)
            return target->pub.path;
    }

    return NULL;
}

static int workspace_legacy_match(const cberg_graph *g, const graph_ref_rec *reference, const graph_node_rec *candidate) {
    const graph_node_rec *source = graph_node_rec_by_id(g, graph_file_id(reference->path));
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

        const graph_node_rec *file = graph_node_rec_by_id(g, import->dst);
        if (file != NULL && file->pub.kind == CBERG_GNODE_FILE && file->pub.path != NULL &&
            candidate->pub.path != NULL && strcmp(file->pub.path, candidate->pub.path) == 0)
            return 1;
    }

    return 0;
}

static int binding_matches(const cberg_graph *g, const graph_ref_rec *reference, const graph_node_rec *candidate, const char *target_path) {
    const graph_node_rec *file = graph_node_rec_by_id(g, graph_file_id(reference->path));
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

int graph_candidates_contain(const graph_candidates *c, uint32_t node_index) {
    for (size_t i = 0; i < c->count; i++) {
        if (c->idx[i] == node_index) {
            return 1;
        }
    }
    return 0;
}

static int same_optional_string(const char *a, const char *b) {
    return a == b || (a != NULL && b != NULL && strcmp(a, b) == 0);
}

void graph_resolve_name_cached(const cberg_graph *g, const graph_ref_rec *reference, resolve_memo *memo, graph_candidates *out) {
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
