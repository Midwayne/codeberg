/* Workspace view: several repositories' graphs copied into one. */
#include "graph_store.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "workspace_graph.h"

uint64_t cberg_graph_revision(const cberg_graph *graph) {
    return graph != NULL ? graph->revision : 0;
}

const char *cberg_graph_source_repo(const cberg_graph *graph, uint64_t id) {
    const graph_node_rec *node = graph_node_rec_by_id(graph, id);
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
    const graph_node_rec *node = graph_node_rec_by_id(graph, id);
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

const char *cberg_graph_workspace_file(const cberg_graph *graph, const char *repo, const char *path) {
    for (size_t i = 0; i < graph->nodes_len; i++) {
        const graph_node_rec *node = &graph->nodes[i];
        if (node->dead || node->pub.kind != CBERG_GNODE_FILE || node->repo == NULL ||
            strcmp(node->repo, repo) != 0)
            continue;
        if (strcmp(cberg_graph_source_path(graph, &node->pub), path) == 0)
            return node->pub.path;
    }

    return NULL;
}

cberg_status cberg_graph_link_import(cberg_graph *graph, uint64_t source_file, uint64_t module, const char *target_file) {
    const graph_node_rec *target = graph_node_rec_by_id(graph, graph_file_id(target_file));
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
            if (graph_node_rec_by_id(out, node.id) != NULL)
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
