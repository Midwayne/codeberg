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

static bool skip_component(const char *name, size_t len) {
    char part[256];
    if (len == 0 || len >= sizeof(part)) {
        return false;
    }

    memcpy(part, name, len);
    part[len] = '\0';
    return cberg_walk_skip_dir(part) != 0;
}

bool cberg_walk_skip_rel(const char *rel, bool is_dir) {
    if (rel == NULL) {
        return false;
    }

    const char *start = rel;
    const char *slash;
    while ((slash = strchr(start, '/')) != NULL) {
        if (skip_component(start, (size_t)(slash - start))) {
            return true;
        }
        start = slash + 1;
    }
    return is_dir && skip_component(start, strlen(start));
}
