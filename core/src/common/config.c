#include "codeberg/codeberg.h"

#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

const char *cberg_config_index_root_env_name(void) {
    return CBERG_INDEX_ROOT_ENV;
}

const char *cberg_config_index_root(void) {
    const char *value = getenv(CBERG_INDEX_ROOT_ENV);
    if (value == NULL || value[0] == '\0') {
        return NULL;
    }
    return value;
}

cberg_status cberg_config_resolve_index_root(char *out, size_t out_cap) {
    const char *root = cberg_config_index_root();
    if (root == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    if (out == NULL || out_cap == 0) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char resolved[PATH_MAX];
    if (realpath(root, resolved) == NULL) {
        return CBERG_ERR_IO;
    }
    size_t len = strlen(resolved);
    if (len + 1 > out_cap) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    memcpy(out, resolved, len + 1);
    return CBERG_OK;
}
