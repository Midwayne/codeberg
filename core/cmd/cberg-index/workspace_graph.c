#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "statutil.h"
#include "workspace_graph.h"

struct cberg_workspace_cache {
    cberg_graph *graph;
    const cberg_graph **sources;
    uint64_t *revisions;
    uint64_t *manifests;
    size_t count;
};

typedef struct workspace_view {
    cberg_repo repo;
    cberg_engine *owner;
} workspace_view;

void cberg_workspace_free(cberg_workspace_cache *cache) {
    if (cache == NULL)
        return;
    cberg_graph_free(cache->graph);
    free(cache->sources);
    free(cache->revisions);
    free(cache->manifests);
    free(cache);
}

static uint64_t manifest_stamp(const cberg_repo *repo) {
    const char *names[] = {CBERG_WORKSPACE_GO_MOD, CBERG_WORKSPACE_PACKAGE_JSON, CBERG_WORKSPACE_CARGO_TOML};
    uint64_t stamp = 0;
    for (size_t i = 0; i < sizeof names / sizeof names[0]; i++) {
        char path[4096];
        snprintf(path, sizeof path, "%s/%s", repo->root, names[i]);
        struct stat info;
        if (stat(path, &info) != 0)
            continue;
        stamp = stamp * 1099511628211ULL ^ (uint64_t)CBERG_STAT_MTIME_NS(info) ^ (uint64_t)info.st_size;
    }
    return stamp;
}

static int cache_matches(const cberg_workspace_cache *cache, const cberg_engine *engine) {
    if (cache == NULL || cache->count != engine->repos_len)
        return 0;
    for (size_t i = 0; i < cache->count; i++) {
        const cberg_repo *repo = engine->repos[i];
        const cberg_graph *source = repo->ready ? repo->graph : NULL;
        if (cache->sources[i] != source || cache->revisions[i] != cberg_graph_revision(source))
            return 0;
        if (cache->manifests[i] != manifest_stamp(repo))
            return 0;
    }
    return 1;
}

static cberg_status rebuild_workspace(cberg_engine *engine) {
    cberg_workspace_cache *cache = calloc(1, sizeof(*cache));
    if (cache == NULL)
        return CBERG_ERR_OUT_OF_MEMORY;
    cache->count = engine->repos_len;
    cache->sources = calloc(cache->count, sizeof(*cache->sources));
    cache->revisions = calloc(cache->count, sizeof(*cache->revisions));
    cache->manifests = calloc(cache->count, sizeof(*cache->manifests));
    cberg_status status = cberg_graph_new(&cache->graph);
    if (cache->sources == NULL || cache->revisions == NULL || cache->manifests == NULL)
        status = CBERG_ERR_OUT_OF_MEMORY;

    for (size_t i = 0; i < cache->count && status == CBERG_OK; i++) {
        cberg_repo *repo = engine->repos[i];
        cache->sources[i] = repo->ready ? repo->graph : NULL;
        cache->revisions[i] = cberg_graph_revision(cache->sources[i]);
        cache->manifests[i] = manifest_stamp(repo);
        if (cache->sources[i] != NULL) {
            status = cberg_graph_copy_repository(cache->graph, repo->graph, repo->key, i);
        }
    }
    if (status == CBERG_OK)
        status = cberg_workspace_resolve(cache->graph, engine);
    if (status != CBERG_OK) {
        cberg_workspace_free(cache);
        return status;
    }

    cberg_workspace_free(engine->workspace_graph);
    engine->workspace_graph = cache;
    return CBERG_OK;
}

static cberg_status view_begin(cberg_engine *engine, const char *scope, workspace_view *view) {
    if (!engine->graph_enabled)
        return CBERG_ERR_NOT_IMPLEMENTED;
    int known = scope == NULL || scope[0] == '\0';
    for (size_t i = 0; i < engine->repos_len; i++)
        known |= scope != NULL && strcmp(scope, engine->repos[i]->key) == 0;
    if (!known)
        return CBERG_ERR_NOT_FOUND;

    pthread_mutex_lock(&engine->graph_mu);
    for (size_t i = 0; i < engine->repos_len; i++)
        pthread_mutex_lock(&engine->repos[i]->mu);
    cberg_status status = cache_matches(engine->workspace_graph, engine) ? CBERG_OK : rebuild_workspace(engine);
    for (size_t i = engine->repos_len; i > 0; i--)
        pthread_mutex_unlock(&engine->repos[i - 1]->mu);
    if (status != CBERG_OK) {
        pthread_mutex_unlock(&engine->graph_mu);
        return status;
    }

    memset(view, 0, sizeof(*view));
    view->owner = engine;
    view->repo.graph = engine->workspace_graph->graph;
    view->repo.key = "workspace";
    view->repo.ready = 1;
    atomic_init(&view->repo.published_ready, 1);
    pthread_mutex_init(&view->repo.mu, NULL);
    cberg_graph_workspace_scope(view->repo.graph, scope);
    return CBERG_OK;
}

static void view_end(workspace_view *view) {
    cberg_graph_workspace_scope(view->repo.graph, NULL);
    pthread_mutex_destroy(&view->repo.mu);
    pthread_mutex_unlock(&view->owner->graph_mu);
}

/* Engine responses borrow stable engine keys, not an invalidatable view arena. */
static const char *engine_repo_key(const cberg_engine *engine, const char *key) {
    for (size_t i = 0; i < engine->repos_len; i++) {
        if (key != NULL && strcmp(engine->repos[i]->key, key) == 0)
            return engine->repos[i]->key;
    }
    return "";
}

cberg_status cberg_workspace_search(cberg_engine *engine, const char *name, const char *repo, const char *kind, const char *path, size_t limit, cberg_engine_graph_node *out, size_t cap, size_t *found) {
    workspace_view view;
    cberg_status status = view_begin(engine, repo, &view);
    if (status != CBERG_OK)
        return status;
    status = cberg_repo_graph_search(&view.repo, name, kind, path, limit, out, cap, found);
    for (size_t i = 0; i < *found; i++)
        out[i].repo = engine_repo_key(engine, out[i].repo);
    view_end(&view);
    return status;
}

cberg_status cberg_workspace_refs(cberg_engine *engine, const char *name, const char *repo, const char *path, size_t limit, cberg_engine_graph_edge *out, size_t cap, size_t *found) {
    workspace_view view;
    cberg_status status = view_begin(engine, repo, &view);
    if (status != CBERG_OK)
        return status;
    status = cberg_repo_graph_references(&view.repo, name, path, limit, out, cap, found);
    view_end(&view);
    return status;
}

static int ambiguous_start(cberg_graph *graph, const char *name, const char *path) {
    size_t capacity = 0, count = 0;
    cberg_graph_counts(graph, &capacity, NULL);
    const cberg_graph_node **nodes = calloc(capacity + 1, sizeof(*nodes));
    if (nodes == NULL)
        return -1;
    cberg_status status = cberg_graph_find_nodes(graph, name, 0, path, nodes, capacity + 1, &count);
    int ambiguous = status != CBERG_OK;
    const char *first = count > 0 ? cberg_graph_source_repo(graph, nodes[0]->id) : NULL;
    for (size_t i = 1; i < count && !ambiguous; i++) {
        const char *repo = cberg_graph_source_repo(graph, nodes[i]->id);
        ambiguous = first != NULL && repo != NULL && strcmp(first, repo) != 0;
    }
    free(nodes);
    return ambiguous;
}

cberg_status cberg_workspace_trace(cberg_engine *engine, const char *name, uint64_t start, const char *repo, const char *path, const char *direction, const char *kind, uint32_t depth, size_t limit, cberg_engine_graph_hop *out, size_t cap, size_t *found) {
    workspace_view view;
    cberg_status status = view_begin(engine, repo, &view);
    if (status != CBERG_OK)
        return status;
    if ((repo == NULL || repo[0] == '\0') && (start != 0 || ambiguous_start(view.repo.graph, name, path) != 0)) {
        view_end(&view);
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (start != 0) {
        start = cberg_graph_workspace_id(view.repo.graph, repo, start);
        if (start == 0)
            status = CBERG_ERR_NOT_FOUND;
    }
    if (status == CBERG_OK) {
        status = cberg_repo_graph_trace(&view.repo, name, start, path, direction, kind, depth, limit, out, cap, found);
    }
    view_end(&view);
    return status;
}

cberg_status cberg_workspace_hubs(cberg_engine *engine, const char *repo, size_t limit, cberg_engine_graph_hub *out, size_t cap, size_t *found) {
    workspace_view view;
    cberg_status status = view_begin(engine, repo, &view);
    if (status != CBERG_OK)
        return status;
    status = cberg_repo_graph_hubs(&view.repo, limit, out, cap, found);
    for (size_t i = 0; i < *found; i++)
        out[i].node.repo = engine_repo_key(engine, out[i].node.repo);
    view_end(&view);
    return status;
}

cberg_status cberg_workspace_stats(cberg_engine *engine, cberg_engine_graph_stats *out) {
    out->repo = "";
    size_t available = 0;
    for (size_t i = 0; i < engine->repos_len; i++) {
        cberg_engine_graph_stats item;
        cberg_status status = cberg_engine_get_graph_stats(engine, engine->repos[i]->key, &item);
        if (status != CBERG_OK)
            continue;
        available++;
        out->nodes += item.nodes;
        out->refs += item.refs;
        for (size_t j = 0; j < item.languages_len; j++) {
            size_t slot = 0;
            while (slot < out->languages_len && strcmp(out->languages[slot].lang, item.languages[j].lang) != 0)
                slot++;
            if (slot == out->languages_len) {
                if (slot == sizeof out->languages / sizeof out->languages[0])
                    continue;
                out->languages[slot] = item.languages[j];
                out->languages_len++;
            } else {
                out->languages[slot].files += item.languages[j].files;
            }
        }
    }
    return available > 0 ? CBERG_OK : CBERG_ERR_NOT_FOUND;
}
