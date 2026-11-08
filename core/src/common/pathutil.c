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

static cberg_status walk_dir(DIR *dir, const char *abs, const char *rel, cberg_fs_walk_fn fn, void *ctx);

/* Visits one directory entry; entries that vanish, are not regular files or
 * directories (symlinks included), or are policy-skipped directories are
 * passed over. */
static cberg_status walk_entry(const char *abs, const char *rel, const char *name, cberg_fs_walk_fn fn, void *ctx) {
    char child_abs[PATH_MAX];
    char child_rel[PATH_MAX];
    if (!cberg_path_join(abs, name, child_abs, sizeof(child_abs))) {
        return CBERG_OK;
    }
    if (!cberg_path_join(rel, name, child_rel, sizeof(child_rel))) {
        return CBERG_OK;
    }

    struct stat stbuf;
    if (lstat(child_abs, &stbuf) != 0) {
        return CBERG_OK;
    }

    if (S_ISDIR(stbuf.st_mode)) {
        DIR *dir = cberg_walk_skip_dir(name) ? NULL : opendir(child_abs);
        return dir != NULL ? walk_dir(dir, child_abs, child_rel, fn, ctx) : CBERG_OK;
    }
    if (S_ISREG(stbuf.st_mode)) {
        return fn(ctx, child_abs, child_rel, CBERG_FS_FILE);
    }
    return CBERG_OK;
}

/* Reports `dir`, then its entries; always closes `dir`. */
static cberg_status walk_dir(DIR *dir, const char *abs, const char *rel, cberg_fs_walk_fn fn, void *ctx) {
    cberg_status st = fn(ctx, abs, rel, CBERG_FS_DIR);

    struct dirent *ent;
    while (st == CBERG_OK && (ent = readdir(dir)) != NULL) {
        if (!dirent_dot(ent->d_name)) {
            st = walk_entry(abs, rel, ent->d_name, fn, ctx);
        }
    }

    closedir(dir);
    return st;
}

cberg_status cberg_fs_walk(const char *abs, const char *rel, cberg_fs_walk_fn fn, void *ctx) {
    if (abs == NULL || rel == NULL || fn == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    DIR *dir = opendir(abs);
    if (dir == NULL) {
        return CBERG_ERR_IO;
    }
    return walk_dir(dir, abs, rel, fn, ctx);
}

typedef struct {
    cberg_walk_files_fn fn;
    void *ctx;
} walk_files_ctx;

static cberg_status walk_files_visit(void *ctx, const char *abs, const char *rel, cberg_fs_entry_kind kind) {
    walk_files_ctx *wf = ctx;
    if (kind != CBERG_FS_FILE) {
        return CBERG_OK;
    }
    return wf->fn(abs, rel, wf->ctx) == 0 ? CBERG_OK : CBERG_ERR_INTERNAL;
}

int cberg_fs_walk_files(const char *root, cberg_walk_files_fn fn, void *ctx) {
    if (root == NULL || fn == NULL) {
        return -1;
    }

    walk_files_ctx wf = {.fn = fn, .ctx = ctx};
    return cberg_fs_walk(root, "", walk_files_visit, &wf) == CBERG_OK ? 0 : -1;
}
