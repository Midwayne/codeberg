#include "registry.h"

#include <strings.h>

extern const cberg_index_provider_ops cberg_usearch_provider;
extern const cberg_index_provider_ops cberg_qdrant_provider;
#ifdef CBERG_WITH_PGVECTOR
extern const cberg_index_provider_ops cberg_pgvector_provider;
#endif

static const cberg_index_provider_ops *provider_table[] = {
    &cberg_usearch_provider,
    &cberg_qdrant_provider,
#ifdef CBERG_WITH_PGVECTOR
    &cberg_pgvector_provider,
#endif
};

const cberg_index_provider_ops *cberg_index_provider_get(cberg_index_provider id) {
    for (size_t i = 0; i < sizeof(provider_table) / sizeof(provider_table[0]); i++) {
        if (provider_table[i]->id == id) {
            return provider_table[i];
        }
    }
    return NULL;
}

const cberg_index_provider_ops *cberg_index_provider_by_name(const char *name) {
    if (name == NULL || name[0] == '\0') {
        return NULL;
    }
    if (strcasecmp(name, "postgres") == 0) {
        name = "pgvector";
    }
    for (size_t i = 0; i < sizeof(provider_table) / sizeof(provider_table[0]); i++) {
        if (strcasecmp(provider_table[i]->name, name) == 0) {
            return provider_table[i];
        }
    }
    return NULL;
}

int cberg_index_provider_parse(const char *name) {
    const cberg_index_provider_ops *ops = cberg_index_provider_by_name(name);
    return ops == NULL ? -1 : (int)ops->id;
}

cberg_status cberg_index_provider_open(cberg_index_provider id, const char *path, size_t dim, const cberg_index_config *config, cberg_index_backend **out) {
    const cberg_index_provider_ops *ops = cberg_index_provider_get(id);
    if (ops == NULL || ops->open == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    return ops->open(path, dim, config, out);
}

cberg_status cberg_index_provider_wipe(cberg_index_provider id, const char *path, size_t dim, const cberg_index_config *config) {
    const cberg_index_provider_ops *ops = cberg_index_provider_get(id);
    if (ops == NULL || ops->wipe == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    return ops->wipe(path, dim, config);
}

int cberg_index_provider_rebuild_inplace(cberg_index_provider id) {
    const cberg_index_provider_ops *ops = cberg_index_provider_get(id);
    return ops != NULL && ops->rebuild_inplace;
}
