#ifndef CBERG_INDEX_WORKSPACE_GRAPH_H
#define CBERG_INDEX_WORKSPACE_GRAPH_H

#include "graph_workspace.h"
#include "indexer.h"

typedef struct cberg_workspace_cache cberg_workspace_cache;
void cberg_workspace_free(cberg_workspace_cache *cache);
cberg_status cberg_workspace_resolve(cberg_graph *graph, cberg_engine *engine);
cberg_status cberg_workspace_search(cberg_engine *, const char *, const char *, const char *, const char *, size_t, cberg_engine_graph_node *, size_t, size_t *);
cberg_status cberg_workspace_refs(cberg_engine *, const char *, const char *, const char *, size_t, cberg_engine_graph_edge *, size_t, size_t *);
cberg_status cberg_workspace_trace(cberg_engine *, const char *, uint64_t, const char *, const char *, const char *, const char *, uint32_t, size_t, cberg_engine_graph_hop *, size_t, size_t *);
cberg_status cberg_workspace_hubs(cberg_engine *, const char *, size_t, cberg_engine_graph_hub *, size_t, size_t *);
cberg_status cberg_workspace_stats(cberg_engine *, cberg_engine_graph_stats *);

#endif
