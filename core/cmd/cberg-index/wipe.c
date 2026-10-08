#include "codeberg/codeberg.h"
#include "wipe.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int cberg_wipe_index(const char *base, const char *root) {
    cberg_index_config cfg;
    cberg_index_config_default(&cfg);
    const char *backend = getenv("CBERG_INDEX_BACKEND");
    if (backend != NULL && cberg_index_provider_from_name(backend, &cfg.provider) != CBERG_OK) {
        return 1;
    }

    cfg.vectordb_url = getenv("CBERG_VECTORDB_URL");
    cfg.vectordb_api_key = getenv("CBERG_VECTORDB_API_KEY");
    cfg.postgres_url = getenv("CBERG_POSTGRES_URL");

    uint8_t hash[CBERG_HASH_LEN];
    if (cberg_hash(root, strlen(root), hash) != CBERG_OK) {
        return 1;
    }

    static const char hex[] = "0123456789abcdef";
    size_t len = strlen(base);
    char *path = malloc(len + 18);
    if (path == NULL) {
        return 1;
    }

    memcpy(path, base, len);
    path[len++] = '.';
    for (size_t i = 0; i < 8; i++) {
        path[len + 2 * i] = hex[hash[i] >> 4];
        path[len + 2 * i + 1] = hex[hash[i] & 0x0F];
    }
    path[len + 16] = '\0';

    /* Wipe providers ignore the dimension; no embedding runtime is opened. */
    cberg_status st = cberg_index_wipe(path, 1, &cfg);
    free(path);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index: deleting vector index: %s\n", cberg_status_str(st));
    }

    return st == CBERG_OK ? 0 : 1;
}
