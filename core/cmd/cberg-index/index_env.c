#define _POSIX_C_SOURCE 200809L

#include "index_env.h"

#include "hash_tag.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *env_value(const char *name) {
    const char *v = getenv(name);
    return (v != NULL && v[0] != '\0') ? v : NULL;
}

/* Copies an optional variable; 0 only when the copy failed. */
static int copy_env(const char *name, char **out) {
    const char *v = env_value(name);
    *out = v != NULL ? strdup(v) : NULL;
    return v == NULL || *out != NULL;
}

static cberg_status parse_names(cberg_index_config *cfg) {
    const char *backend = env_value("CBERG_INDEX_BACKEND");
    if (backend != NULL && cberg_index_provider_from_name(backend, &cfg->provider) != CBERG_OK) {
        fprintf(stderr, "cberg-index: unknown CBERG_INDEX_BACKEND '%s' (use: usearch, qdrant, pgvector, postgres)\n", backend);
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    const char *quant = env_value("CBERG_INDEX_QUANT");
    if (quant != NULL && cberg_index_quant_from_name(quant, &cfg->quantization) != CBERG_OK) {
        fprintf(stderr, "cberg-index: unknown CBERG_INDEX_QUANT '%s' (use: f32, i8)\n", quant);
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    return CBERG_OK;
}

static cberg_status require(const char *name, const char *backend, const char *example) {
    if (env_value(name) != NULL) {
        return CBERG_OK;
    }

    fprintf(stderr, "cberg-index: %s is required when CBERG_INDEX_BACKEND=%s\n  e.g. %s=%s\n", name, backend, name, example);
    return CBERG_ERR_INVALID_ARGUMENT;
}

cberg_status cberg_index_env_load(cberg_index_config *cfg, cberg_index_env *env) {
    memset(env, 0, sizeof(*env));
    cberg_index_config_default(cfg);

    cberg_status st = parse_names(cfg);
    if (st != CBERG_OK) {
        return st;
    }

    int copied = 1;
    switch (cfg->provider) {
    case CBERG_INDEX_USEARCH:
        break;
    case CBERG_INDEX_QDRANT:
        st = require("CBERG_VECTORDB_URL", "qdrant", "https://your-cluster.qdrant.io");
        copied = copy_env("CBERG_VECTORDB_URL", &env->vectordb_url) && copy_env("CBERG_VECTORDB_API_KEY", &env->vectordb_api_key);
        break;
    case CBERG_INDEX_PGVECTOR:
        st = require("CBERG_POSTGRES_URL", "pgvector", "postgresql://user:pass@host:5432/dbname");
        copied = copy_env("CBERG_POSTGRES_URL", &env->postgres_url);
        break;
    default:
        /* never: cberg_index_provider_from_name only returns known providers. */
        abort();
    }

    if (st == CBERG_OK && !copied) {
        st = CBERG_ERR_OUT_OF_MEMORY;
    }
    if (st != CBERG_OK) {
        cberg_index_env_free(env);
        return st;
    }

    cfg->vectordb_url = env->vectordb_url;
    cfg->vectordb_api_key = env->vectordb_api_key;
    cfg->postgres_url = env->postgres_url;
    return CBERG_OK;
}

void cberg_index_env_free(cberg_index_env *env) {
    free(env->vectordb_url);
    free(env->vectordb_api_key);
    free(env->postgres_url);
    memset(env, 0, sizeof(*env));
}

char *cberg_index_path_for_root(const char *base, const char *root) {
    char tag[CBERG_HASH_TAG_LEN + 1];
    cberg_hash_tag(root, tag);

    size_t len = strlen(base) + 1 + CBERG_HASH_TAG_LEN + 1;
    char *path = malloc(len);
    if (path != NULL) {
        snprintf(path, len, "%s.%s", base, tag);
    }
    return path;
}
