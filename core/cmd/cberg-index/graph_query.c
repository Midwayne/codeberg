#define _POSIX_C_SOURCE 200809L

#include "indexer.h"

#include "graph_names.h"
#include "lang.h"
#include "workspace_graph.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

static void copy_cstr(char *dst, size_t cap, const char *src) {
    if (cap == 0) {
        return;
    }
    if (src == NULL) {
        dst[0] = '\0';
        return;
    }
    snprintf(dst, cap, "%s", src);
}

static void fill_engine_gnode(cberg_engine_graph_node *out, const char *repo, const cberg_graph *g, const cberg_graph_node *n) {
    out->id = cberg_graph_source_id(g, n->id);
    const char *origin = cberg_graph_source_repo(g, n->id);
    out->repo = origin != NULL ? origin : repo;
    copy_cstr(out->kind, sizeof(out->kind), cberg_graph_node_kind_name(n->kind));
    copy_cstr(out->name, sizeof(out->name), n->name);
    copy_cstr(out->qname, sizeof(out->qname), n->qname);
    copy_cstr(out->path, sizeof(out->path), cberg_graph_source_path(g, n));
    out->start_line = n->span.start_line;
    out->end_line = n->span.end_line;
}

static void fill_engine_gedge(cberg_engine_graph_edge *out, const char *repo, const cberg_graph *g, const cberg_graph_edge *e) {
    out->src = cberg_graph_source_id(g, e->src);
    out->dst = cberg_graph_source_id(g, e->dst);
    copy_cstr(out->kind, sizeof(out->kind), cberg_graph_edge_kind_name(e->kind));
    copy_cstr(out->resolution, sizeof(out->resolution), cberg_graph_resolution_name(e->resolution));
    out->confidence = e->confidence;
    out->line = e->line;
    const cberg_graph_node *src = cberg_graph_node_by_id(g, e->src);
    const cberg_graph_node *dst = cberg_graph_node_by_id(g, e->dst);
    copy_cstr(out->src_name, sizeof(out->src_name), src != NULL ? src->name : NULL);
    copy_cstr(out->dst_name, sizeof(out->dst_name), dst != NULL ? dst->name : NULL);
    copy_cstr(out->src_path, sizeof(out->src_path), cberg_graph_source_path(g, src));
    copy_cstr(out->dst_path, sizeof(out->dst_path), cberg_graph_source_path(g, dst));
    const char *src_repo = cberg_graph_source_repo(g, e->src);
    const char *dst_repo = cberg_graph_source_repo(g, e->dst);
    copy_cstr(out->src_repo, sizeof(out->src_repo), src_repo != NULL ? src_repo : repo);
    copy_cstr(out->dst_repo, sizeof(out->dst_repo), dst_repo != NULL ? dst_repo : repo);
}

/* Pick a ready repo for graph queries. Explicit key must exist; otherwise the
 * first ready repo with a live graph wins (single-repo default). */
static cberg_status graph_repo(cberg_engine *eng, const char *repo_key, cberg_repo **out) {
    *out = NULL;
    if (!eng->graph_enabled) {
        return CBERG_ERR_NOT_IMPLEMENTED;
    }
    if (repo_key != NULL && repo_key[0] != '\0') {
        cberg_repo *r = cberg_engine_find_repo(eng, repo_key);
        if (r == NULL) {
            return CBERG_ERR_NOT_FOUND;
        }
        if (r->graph == NULL) {
            return CBERG_ERR_NOT_IMPLEMENTED;
        }
        *out = r;
        return CBERG_OK;
    }
    for (size_t i = 0; i < eng->repos_len; i++) {
        cberg_repo *r = eng->repos[i];
        if (cberg_repo_ready(r) && r->graph != NULL) {
            *out = r;
            return CBERG_OK;
        }
    }
    return CBERG_ERR_NOT_FOUND;
}

cberg_status cberg_engine_search_graph(cberg_engine *eng, const char *name, const char *repo_key, const char *kind, const char *path_prefix, size_t limit, cberg_engine_graph_node *out, size_t cap, size_t *found) {
    if (eng == NULL || out == NULL || found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *found = 0;
    if (eng->repos_len > 1)
        return cberg_workspace_search(eng, name, repo_key, kind, path_prefix, limit, out, cap, found);
    cberg_repo *r = NULL;
    cberg_status st = graph_repo(eng, repo_key, &r);
    if (st != CBERG_OK) {
        return st;
    }
    limit = cberg_query_limit(limit, CBERG_GRAPH_SEARCH_DEFAULT, CBERG_GRAPH_SEARCH_MAX, cap);
    uint32_t kind_mask = cberg_graph_node_mask_parse(kind);
    const char *name_filter = (name != NULL && name[0] != '\0') ? name : NULL;
    const char *path_filter = (path_prefix != NULL && path_prefix[0] != '\0') ? path_prefix : NULL;

    const cberg_graph_node *nodes[CBERG_GRAPH_SEARCH_MAX];
    size_t n = 0;
    pthread_mutex_lock(&r->mu);
    if (!r->ready || r->graph == NULL) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    st = cberg_graph_find_nodes(r->graph, name_filter, kind_mask, path_filter, nodes, limit, &n);
    if (st == CBERG_OK) {
        for (size_t i = 0; i < n; i++) {
            fill_engine_gnode(&out[i], r->key, r->graph, nodes[i]);
        }
        *found = n;
    }
    pthread_mutex_unlock(&r->mu);
    return st;
}

cberg_status cberg_engine_trace_path(cberg_engine *eng, const char *name, uint64_t start_id, const char *repo_key, const char *path_prefix, const char *direction, const char *edge_kind, uint32_t max_depth, size_t limit, cberg_engine_graph_hop *out, size_t cap, size_t *found) {
    if (eng == NULL || out == NULL || found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *found = 0;
    if (eng->repos_len > 1)
        return cberg_workspace_trace(eng, name, start_id, repo_key, path_prefix, direction, edge_kind, max_depth, limit, out, cap, found);
    cberg_repo *r = NULL;
    cberg_status st = graph_repo(eng, repo_key, &r);
    if (st != CBERG_OK) {
        return st;
    }
    limit = cberg_query_limit(limit, CBERG_TRACE_DEFAULT, CBERG_TRACE_MAX, cap);
    if (max_depth == 0) {
        max_depth = CBERG_TRACE_DEPTH_DEFAULT;
    }

    uint32_t dirs = CBERG_GRAPH_IN | CBERG_GRAPH_OUT;
    if (direction != NULL && direction[0] != '\0') {
        if (strcasecmp(direction, "out") == 0) {
            dirs = CBERG_GRAPH_OUT;
        } else if (strcasecmp(direction, "in") == 0) {
            dirs = CBERG_GRAPH_IN;
        } else if (strcasecmp(direction, "both") != 0) {
            return CBERG_ERR_INVALID_ARGUMENT;
        }
    }

    uint32_t kind_mask = cberg_graph_edge_mask_parse(edge_kind);
    if (kind_mask == 0) {
        kind_mask = CBERG_GEDGE_CALLS;
    }

    pthread_mutex_lock(&r->mu);
    if (!r->ready || r->graph == NULL) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }

    uint64_t id = start_id;
    if (id == 0) {
        if (name == NULL || name[0] == '\0') {
            pthread_mutex_unlock(&r->mu);
            return CBERG_ERR_INVALID_ARGUMENT;
        }
        const cberg_graph_node *nodes[16];
        size_t n = 0;
        /* Prefer exact path match when path_prefix is a full path; fall back to
         * prefix filter so callers can still pass a directory. */
        const char *path_filter = (path_prefix != NULL && path_prefix[0] != '\0') ? path_prefix : NULL;
        st = cberg_graph_find_nodes(r->graph, name, 0, path_filter, nodes, 16, &n);
        if (st != CBERG_OK || n == 0) {
            pthread_mutex_unlock(&r->mu);
            return CBERG_ERR_NOT_FOUND;
        }
        id = nodes[0]->id;
        if (path_filter != NULL) {
            for (size_t i = 0; i < n; i++) {
                if (nodes[i]->path != NULL && strcmp(cberg_graph_source_path(r->graph, nodes[i]), path_filter) == 0) {
                    id = nodes[i]->id;
                    break;
                }
            }
        }
    }

    cberg_graph_hop hops[CBERG_TRACE_MAX];
    size_t hop_n = 0;
    st = cberg_graph_trace(r->graph, id, dirs, kind_mask, max_depth, hops, limit, &hop_n);
    if (st == CBERG_OK) {
        for (size_t i = 0; i < hop_n; i++) {
            fill_engine_gedge(&out[i].edge, r->key, r->graph, &hops[i].edge);
            out[i].depth = hops[i].depth;
        }
        *found = hop_n;
    }
    pthread_mutex_unlock(&r->mu);
    return st;
}

/* Graph stats count code files only. */
static const char *code_lang_name(cberg_language lang) {
    return cberg_language_is_code(lang) ? cberg_language_name(lang) : NULL;
}

static void bump_lang(cberg_engine_graph_stats *out, const char *lang) {
    if (lang == NULL) {
        return;
    }
    for (size_t i = 0; i < out->languages_len; i++) {
        if (strcmp(out->languages[i].lang, lang) == 0) {
            out->languages[i].files++;
            return;
        }
    }
    if (out->languages_len >= sizeof(out->languages) / sizeof(out->languages[0])) {
        return;
    }
    copy_cstr(out->languages[out->languages_len].lang, sizeof(out->languages[0].lang), lang);
    out->languages[out->languages_len].files = 1;
    out->languages_len++;
}

cberg_status cberg_engine_get_graph_stats(cberg_engine *eng, const char *repo_key, cberg_engine_graph_stats *out) {
    if (eng == NULL || out == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    memset(out, 0, sizeof(*out));
    out->enabled = eng->graph_enabled;
    if (!eng->graph_enabled) {
        return CBERG_ERR_NOT_IMPLEMENTED;
    }
    if (eng->repos_len > 1 && (repo_key == NULL || repo_key[0] == '\0'))
        return cberg_workspace_stats(eng, out);
    cberg_repo *r = NULL;
    cberg_status st = graph_repo(eng, repo_key, &r);
    if (st != CBERG_OK) {
        return st;
    }
    pthread_mutex_lock(&r->mu);
    out->repo = r->key;
    out->enabled = r->graph != NULL;
    if (r->graph != NULL) {
        cberg_graph_counts(r->graph, &out->nodes, &out->refs);
        /* Language mix from FILE node path extensions. */
        if (out->nodes > 0) {
            const cberg_graph_node **files = calloc(out->nodes, sizeof(*files));
            if (files != NULL) {
                size_t nfiles = 0;
                if (cberg_graph_find_nodes(r->graph, NULL, CBERG_GNODE_MASK(CBERG_GNODE_FILE), NULL, files, out->nodes, &nfiles) ==
                    CBERG_OK) {
                    for (size_t i = 0; i < nfiles; i++) {
                        const char *path = files[i]->qname != NULL ? files[i]->qname : files[i]->path;
                        bump_lang(out, code_lang_name(cberg_language_from_path(path)));
                    }
                }
                free(files);
            }
        }
    }
    pthread_mutex_unlock(&r->mu);
    return CBERG_OK;
}

cberg_status cberg_engine_graph_hubs(cberg_engine *eng, const char *repo_key, size_t limit, cberg_engine_graph_hub *out, size_t cap, size_t *found) {
    if (eng == NULL || out == NULL || found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *found = 0;
    if (eng->repos_len > 1)
        return cberg_workspace_hubs(eng, repo_key, limit, out, cap, found);
    cberg_repo *r = NULL;
    cberg_status st = graph_repo(eng, repo_key, &r);
    if (st != CBERG_OK) {
        return st;
    }
    limit = cberg_query_limit(limit, CBERG_HUBS_DEFAULT, CBERG_HUBS_MAX, cap);

    pthread_mutex_lock(&r->mu);
    if (!r->ready || r->graph == NULL) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }

    cberg_graph_hub hubs[CBERG_HUBS_MAX];
    size_t n = 0;
    st = cberg_graph_hubs(r->graph, hubs, limit, &n);
    if (st == CBERG_OK) {
        for (size_t i = 0; i < n; i++) {
            const cberg_graph_node *node = cberg_graph_node_by_id(r->graph, hubs[i].id);
            if (node == NULL) {
                continue;
            }
            fill_engine_gnode(&out[*found].node, r->key, r->graph, node);
            out[*found].degree = hubs[i].degree;
            (*found)++;
        }
    }
    pthread_mutex_unlock(&r->mu);
    return st;
}

cberg_status cberg_engine_graph_references(cberg_engine *eng, const char *name, const char *repo_key, const char *path_prefix, size_t limit, cberg_engine_graph_edge *out, size_t cap, size_t *found) {
    if (eng == NULL || name == NULL || name[0] == '\0' || out == NULL || found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *found = 0;
    if (eng->repos_len > 1)
        return cberg_workspace_refs(eng, name, repo_key, path_prefix, limit, out, cap, found);
    cberg_repo *r = NULL;
    cberg_status st = graph_repo(eng, repo_key, &r);
    if (st != CBERG_OK) {
        return st;
    }
    limit = cberg_query_limit(limit, CBERG_REFS_DEFAULT, CBERG_REFS_MAX, cap);

    pthread_mutex_lock(&r->mu);
    if (!r->ready || r->graph == NULL) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }

    const char *path_filter = (path_prefix != NULL && path_prefix[0] != '\0') ? path_prefix : NULL;
    size_t capacity = 0;
    cberg_graph_counts(r->graph, &capacity, NULL);
    const cberg_graph_node **nodes = calloc(capacity + 1, sizeof(*nodes));
    if (nodes == NULL) {
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    size_t n_nodes = 0;
    st = cberg_graph_find_nodes(r->graph, name, 0, path_filter, nodes, capacity + 1, &n_nodes);
    if (st != CBERG_OK || n_nodes == 0) {
        free(nodes);
        pthread_mutex_unlock(&r->mu);
        return CBERG_ERR_NOT_FOUND;
    }
    /* Prefer an exact path match when path_prefix is a full file path. */
    if (path_filter != NULL && n_nodes > 1) {
        size_t exact = 0;
        for (size_t i = 0; i < n_nodes; i++) {
            if (nodes[i]->path != NULL && strcmp(cberg_graph_source_path(r->graph, nodes[i]), path_filter) == 0) {
                nodes[exact++] = nodes[i];
            }
        }
        if (exact > 0) {
            n_nodes = exact;
        }
    }

    /* Include non-call symbol uses such as callbacks and type annotations. */
    uint32_t kind_mask = CBERG_GEDGE_CALLS | CBERG_GEDGE_INHERITS | CBERG_GEDGE_IMPORTS | CBERG_GEDGE_REFERENCES;
    size_t written = 0;
    for (size_t i = 0; i < n_nodes && written < limit; i++) {
        cberg_graph_edge edges[CBERG_REFS_MAX];
        size_t n_edges = 0;
        st = cberg_graph_edges_to(r->graph, nodes[i]->id, kind_mask, edges, CBERG_REFS_MAX, &n_edges);
        if (st != CBERG_OK) {
            continue;
        }
        for (size_t e = 0; e < n_edges && written < limit; e++) {
            fill_engine_gedge(&out[written], r->key, r->graph, &edges[e]);
            written++;
        }
    }
    *found = written;
    free(nodes);
    pthread_mutex_unlock(&r->mu);
    return CBERG_OK;
}
