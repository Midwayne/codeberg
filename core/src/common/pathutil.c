#include "pathutil.h"

#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "walk_policy.h"

bool cberg_path_join(const char *root, const char *rel, char *out, size_t out_cap) {
    if (root == NULL || rel == NULL || out == NULL || out_cap == 0) {
        return false;
    }
    size_t root_len = strlen(root);
    size_t rel_len = strlen(rel);
    int need_sep = root_len > 0 && root[root_len - 1] != '/' && rel[0] != '/';
    size_t total = root_len + (need_sep ? 1 : 0) + rel_len;
    if (total + 1 > out_cap) {
        return false;
    }
    memcpy(out, root, root_len);
    size_t at = root_len;
    if (need_sep) {
        out[at++] = '/';
    }
    memcpy(out + at, rel, rel_len);
    out[at + rel_len] = '\0';
    return true;
}

cberg_status cberg_path_resolve(const char *path, char *out, size_t out_cap) {
    if (path == NULL || out == NULL || out_cap == 0) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char resolved[PATH_MAX];
    if (realpath(path, resolved) == NULL) {
        return CBERG_ERR_IO;
    }
    size_t len = strlen(resolved);
    if (len + 1 > out_cap) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    memcpy(out, resolved, len + 1);
    return CBERG_OK;
}

static bool dirent_dot(const char *name) {
    return name[0] == '.' && (name[1] == '\0' || (name[1] == '.' && name[2] == '\0'));
}

cberg_status cberg_fs_walk(const char *abs, const char *rel, cberg_fs_walk_fn fn, void *ctx, cberg_fs_skip_dir_fn skip_dir, void *skip_ctx) {
    if (abs == NULL || rel == NULL || fn == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    cberg_status st = fn(ctx, abs, rel, CBERG_FS_DIR);
    if (st != CBERG_OK) {
        return st;
    }

    DIR *dir = opendir(abs);
    if (dir == NULL) {
        return rel[0] == '\0' ? CBERG_ERR_IO : CBERG_OK;
    }

    struct dirent *ent;
    while ((ent = readdir(dir)) != NULL) {
        if (dirent_dot(ent->d_name)) {
            continue;
        }
        if (skip_dir != NULL && skip_dir(ent->d_name, skip_ctx)) {
            continue;
        }
        char child_abs[PATH_MAX];
        char child_rel[PATH_MAX];
        if (!cberg_path_join(abs, ent->d_name, child_abs, sizeof(child_abs))) {
            continue;
        }
        if (!cberg_path_join(rel, ent->d_name, child_rel, sizeof(child_rel))) {
            continue;
        }
        struct stat stbuf;
        if (stat(child_abs, &stbuf) != 0) {
            continue;
        }
        if (S_ISDIR(stbuf.st_mode)) {
            st = cberg_fs_walk(child_abs, child_rel, fn, ctx, skip_dir, skip_ctx);
            if (st != CBERG_OK) {
                closedir(dir);
                return st;
            }
        } else if (S_ISREG(stbuf.st_mode)) {
            st = fn(ctx, child_abs, child_rel, CBERG_FS_FILE);
            if (st != CBERG_OK) {
                closedir(dir);
                return st;
            }
        }
    }
    closedir(dir);
    return CBERG_OK;
}

static bool dirent_is_dot(const char *name) {
    return name[0] == '.' && (name[1] == '\0' || (name[1] == '.' && name[2] == '\0'));
}

static int walk_files_dir(const char *root, const char *rel, cberg_walk_files_fn fn, void *ctx) {
    char dirpath[PATH_MAX];
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
        if (dirent_is_dot(ent->d_name)) {
            continue;
        }

        char child_rel[PATH_MAX];
        if (rel[0] == '\0') {
            snprintf(child_rel, sizeof(child_rel), "%s", ent->d_name);
        } else {
            snprintf(child_rel, sizeof(child_rel), "%s/%s", rel, ent->d_name);
        }

        char abspath[PATH_MAX];
        if (!cberg_path_join(root, child_rel, abspath, sizeof(abspath))) {
            closedir(d);
            return -1;
        }

        struct stat st;
        if (lstat(abspath, &st) != 0) {
            if (errno == ENOENT) {
                continue;
            }
            closedir(d);
            return -1;
        }

        if (S_ISDIR(st.st_mode)) {
            if (cberg_walk_skip_dir(ent->d_name)) {
                continue;
            }
            if (walk_files_dir(root, child_rel, fn, ctx) != 0) {
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

int cberg_fs_walk_files(const char *root, cberg_walk_files_fn fn, void *ctx) {
    if (root == NULL || fn == NULL) {
        return -1;
    }
    return walk_files_dir(root, "", fn, ctx);
}
