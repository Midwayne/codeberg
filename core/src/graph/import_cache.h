#ifndef CBERG_IMPORT_CACHE_H
#define CBERG_IMPORT_CACHE_H

#include "codeberg/codeberg.h"

/* Private to the indexer. One cache belongs to one repository, under repo->mu.
 * Invalidating frees all cached paths. Resolve rebuilds lazily on the next call. */
typedef struct cberg_import_cache cberg_import_cache;

void cberg_import_cache_free(cberg_import_cache *cache);
void cberg_import_cache_note(cberg_import_cache **cache, const char *path, int deleted);
cberg_status cberg_graph_resolve_cached(cberg_graph *graph, const char *root, cberg_import_cache **cache);

#endif
