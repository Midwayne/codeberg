#ifndef CBERG_SEARCH_PROVIDER_REGISTRY_H
#define CBERG_SEARCH_PROVIDER_REGISTRY_H

#include "provider.h"

/* Parses CBERG_INDEX_BACKEND value; returns -1 when unknown. */
int cberg_index_provider_parse(const char *name);

const cberg_index_provider_ops *cberg_index_provider_get(cberg_index_provider id);
const cberg_index_provider_ops *cberg_index_provider_by_name(const char *name);

cberg_status cberg_index_provider_open(cberg_index_provider id, const char *path, size_t dim, const cberg_index_config *config, cberg_index_backend **out);
cberg_status cberg_index_provider_wipe(cberg_index_provider id, const char *path, size_t dim, const cberg_index_config *config);

int cberg_index_provider_rebuild_inplace(cberg_index_provider id);

#endif /* CBERG_SEARCH_PROVIDER_REGISTRY_H */
