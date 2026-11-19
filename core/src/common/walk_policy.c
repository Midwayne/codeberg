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

/* `dir` covers `rel` when they are equal or `rel` continues past a '/'. */
static bool dir_covers(const char *dir, const char *rel) {
    size_t len = strlen(dir);

    while (len > 0 && dir[len - 1] == '/') {
        len--;
    }

    if (len == 0 || strncmp(dir, rel, len) != 0) {
        return false;
    }

    return rel[len] == '\0' || rel[len] == '/';
}

bool cberg_walk_excluded(const cberg_exclusions *exclusions, const char *rel) {
    if (exclusions == NULL || rel == NULL) {
        return false;
    }

    for (size_t i = 0; i < exclusions->len; i++) {
        if (exclusions->dirs[i] != NULL && dir_covers(exclusions->dirs[i], rel)) {
            return true;
        }
    }

    return false;
}

bool cberg_walk_skip_dir_cb(const char *name, const char *rel, void *ctx) {
    if (cberg_walk_skip_dir(name) != 0) {
        return true;
    }

    return cberg_walk_excluded(ctx, rel);
}
