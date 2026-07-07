#include "walk_policy.h"

#include <stddef.h>
#include <string.h>

#include "walk_skip_dirs_gen.inc"

int cberg_walk_skip_dir(const char *name) {
    if (name == NULL || name[0] == '\0') {
        return 0;
    }
    for (size_t i = 0; i < sizeof(cberg_walk_skip_dirs) / sizeof(cberg_walk_skip_dirs[0]); i++) {
        if (strcmp(name, cberg_walk_skip_dirs[i]) == 0) {
            return 1;
        }
    }
    return 0;
}

bool cberg_walk_skip_dir_cb(const char *name, void *ctx) {
    (void)ctx;
    return cberg_walk_skip_dir(name) != 0;
}
