#ifndef CBERG_INDEX_WORKSPACE_GRAPH_H
#define CBERG_INDEX_WORKSPACE_GRAPH_H

#include "graph_workspace.h"
#include "indexer.h"

/* Root package manifests the workspace resolver reads. The workspace cache
 * stamps exactly these, so a manifest edit re-resolves cross-repo imports. */
#define CBERG_WORKSPACE_GO_MOD "go.mod"
#define CBERG_WORKSPACE_PACKAGE_JSON "package.json"
#define CBERG_WORKSPACE_CARGO_TOML "Cargo.toml"

typedef struct cberg_workspace_cache cberg_workspace_cache;
void cberg_workspace_free(cberg_workspace_cache *cache);
cberg_status cberg_workspace_resolve(cberg_graph *graph, cberg_engine *engine);
/* One repo, or the synthetic workspace repo. The public engine entry selects which. */
cberg_status cberg_repo_graph_search(cberg_repo *repo, const char *name, const char *kind, const char *path_prefix, size_t limit, cberg_engine_graph_node *out, size_t cap, size_t *found);
cberg_status cberg_repo_graph_trace(cberg_repo *repo, const char *name, uint64_t start_id, const char *path_prefix, const char *direction, const char *edge_kind, uint32_t max_depth, size_t limit, cberg_engine_graph_hop *out, size_t cap, size_t *found);
cberg_status cberg_repo_graph_hubs(cberg_repo *repo, size_t limit, cberg_engine_graph_hub *out, size_t cap, size_t *found);
cberg_status cberg_repo_graph_references(cberg_repo *repo, const char *name, const char *path_prefix, size_t limit, cberg_engine_graph_edge *out, size_t cap, size_t *found);

cberg_status cberg_workspace_search(cberg_engine *, const char *, const char *, const char *, const char *, size_t, cberg_engine_graph_node *, size_t, size_t *);
cberg_status cberg_workspace_refs(cberg_engine *, const char *, const char *, const char *, size_t, cberg_engine_graph_edge *, size_t, size_t *);
cberg_status cberg_workspace_trace(cberg_engine *, const char *, uint64_t, const char *, const char *, const char *, const char *, uint32_t, size_t, cberg_engine_graph_hop *, size_t, size_t *);
cberg_status cberg_workspace_hubs(cberg_engine *, const char *, size_t, cberg_engine_graph_hub *, size_t, size_t *);
cberg_status cberg_workspace_stats(cberg_engine *, cberg_engine_graph_stats *);

#endif
