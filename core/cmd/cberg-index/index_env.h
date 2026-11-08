#ifndef CBERG_INDEX_ENV_H
#define CBERG_INDEX_ENV_H

#include "codeberg/codeberg.h"

/* Connection strings copied out of the environment; cfg points into them. */
typedef struct cberg_index_env {
    char *vectordb_url;
    char *vectordb_api_key;
    char *postgres_url;
} cberg_index_env;

/*
 * Fills cfg from CBERG_INDEX_BACKEND, CBERG_INDEX_QUANT, and the selected
 * backend's connection variables (empty values mean the default). Prints the
 * reason and returns CBERG_ERR_INVALID_ARGUMENT for an unknown name or a
 * missing required URL. On success the caller frees env with
 * cberg_index_env_free once cfg is no longer used.
 */
cberg_status cberg_index_env_load(cberg_index_config *cfg, cberg_index_env *env);
void cberg_index_env_free(cberg_index_env *env);

/* "<base>.<tag of root>": the per-root vector index path. Caller frees. */
char *cberg_index_path_for_root(const char *base, const char *root);

#endif
