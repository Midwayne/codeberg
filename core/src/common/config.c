#include "codeberg/codeberg.h"

#include <stdlib.h>

#include "pathutil.h"

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
    return cberg_path_resolve(root, out, out_cap);
}
