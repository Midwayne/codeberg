#include "wipe.h"

#include "index_env.h"

#include <stdio.h>
#include <stdlib.h>

int cberg_wipe_index(const char *base, const char *root) {
    cberg_index_config cfg;
    cberg_index_env env;
    if (cberg_index_env_load(&cfg, &env) != CBERG_OK) {
        return 1;
    }

    char *path = cberg_index_path_for_root(base, root);
    if (path == NULL) {
        cberg_index_env_free(&env);
        return 1;
    }

    /* Wipe providers ignore the dimension; no embedding runtime is opened. */
    cberg_status st = cberg_index_wipe(path, 1, &cfg);
    free(path);
    cberg_index_env_free(&env);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index: deleting vector index: %s\n", cberg_status_str(st));
    }

    return st == CBERG_OK ? 0 : 1;
}
