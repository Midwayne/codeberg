#include "codeberg/codeberg.h"

#include <stdlib.h>
#include <string.h>

#include "pathutil.h"

const char *cberg_config_index_root_env_name(void) {
    return CBERG_INDEX_ROOT_ENV;
}

const char *cberg_config_index_root(void) {
    const char *value = getenv(CBERG_INDEX_ROOT_ENV);
    if (value == NULL || value[0] == '\0') {
        return NULL;
    }

    /* A single-root helper cannot choose a repository from a multi-root list. */
    const char *tab = strchr(value, '\t');
    if (tab == NULL || tab == value || tab[1] == '\0' || strchr(value, '\n') != NULL) {
        return NULL;
    }

    return tab + 1;
}

cberg_status cberg_config_resolve_index_root(char *out, size_t out_cap) {
    const char *root = cberg_config_index_root();
    if (root == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    return cberg_path_resolve(root, out, out_cap);
}
