#ifndef CBERG_GRAPH_WORKSPACE_H
#define CBERG_GRAPH_WORKSPACE_H

#include "codeberg/codeberg.h"

/* Private query-only view. Original IDs and roots are retained separately;
 * joined paths/IDs are internal and never replace per-repository sidecars. */
uint64_t cberg_graph_revision(const cberg_graph *graph);
cberg_status cberg_graph_copy_repository(cberg_graph *out, const cberg_graph *source, const char *repo, size_t ordinal);
const char *cberg_graph_source_repo(const cberg_graph *graph, uint64_t id);
const char *cberg_graph_source_path(const cberg_graph *graph, const cberg_graph_node *node);
uint64_t cberg_graph_source_id(const cberg_graph *graph, uint64_t id);
uint64_t cberg_graph_workspace_id(const cberg_graph *graph, const char *repo, uint64_t native_id);
void cberg_graph_workspace_scope(cberg_graph *graph, const char *repo);
cberg_status cberg_graph_link_import(cberg_graph *graph, uint64_t source_file, uint64_t module, const char *target_file);
const char *cberg_graph_relative_file(const char *source, const char *import, char *const *files, size_t count);

#endif
