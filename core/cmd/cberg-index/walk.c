#define _POSIX_C_SOURCE 200809L

#include "walk.h"

#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "codeberg/codeberg.h"

static int walk_dir(const char *root, const char *rel, walk_fn fn, void *ctx) {
    char dirpath[4096];
    if (rel[0] == '\0') {
        snprintf(dirpath, sizeof(dirpath), "%s", root);
    } else {
        snprintf(dirpath, sizeof(dirpath), "%s/%s", root, rel);
    }

    DIR *d = opendir(dirpath);
    if (d == NULL) {
        if (errno == ENOENT) {
            return 0;
        }
        return -1;
    }

    struct dirent *ent;
    while ((ent = readdir(d)) != NULL) {
        if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0) {
            continue;
        }

        char child_rel[4096];
        if (rel[0] == '\0') {
            snprintf(child_rel, sizeof(child_rel), "%s", ent->d_name);
        } else {
            snprintf(child_rel, sizeof(child_rel), "%s/%s", rel, ent->d_name);
        }

        char abspath[4096];
        snprintf(abspath, sizeof(abspath), "%s/%s", root, child_rel);

        struct stat st;
        if (lstat(abspath, &st) != 0) {
            if (errno == ENOENT) {
                continue;
            }
            closedir(d);
            return -1;
        }

        if (S_ISDIR(st.st_mode)) {
            if (cberg_watch_skip_dir(ent->d_name)) {
                continue;
            }
            if (walk_dir(root, child_rel, fn, ctx) != 0) {
                closedir(d);
                return -1;
            }
            continue;
        }

        if (!S_ISREG(st.st_mode)) {
            continue;
        }

        if (fn(abspath, child_rel, ctx) != 0) {
            closedir(d);
            return -1;
        }
    }

    closedir(d);
    return 0;
}

int cberg_walk_files(const char *root, walk_fn fn, void *ctx) {
    return walk_dir(root, "", fn, ctx);
}
