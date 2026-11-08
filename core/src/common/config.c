#include "codeberg/codeberg.h"

#include <stdlib.h>
#include <string.h>

#include "pathutil.h"
#include "root_records.h"

const char *cberg_config_index_root_env_name(void) {
    return CBERG_INDEX_ROOT_ENV;
}

const char *cberg_config_index_root(void) {
    const char *value = getenv(CBERG_INDEX_ROOT_ENV);
    if (value == NULL || value[0] == '\0') {
        return NULL;
    }

    /* A single-root helper cannot choose a repository from a multi-root list. */
    if (strchr(value, '\n') != NULL) {
        return NULL;
    }

    cberg_root_record record;
    if (!cberg_root_record_next(&value, &record) || record.key == NULL) {
        return NULL;
    }

    /* No newline remains, so the path span is a C string inside the env value. */
    return record.path;
}

cberg_status cberg_config_resolve_index_root(char *out, size_t out_cap) {
    const char *root = cberg_config_index_root();
    if (root == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }
    return cberg_path_resolve(root, out, out_cap);
}
