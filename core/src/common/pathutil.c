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

/* Visits one directory entry of cberg_fs_walk: recurses into directories
 * and reports regular files. Symlinks are followed (stat); entries that
 * cannot be addressed or inspected are skipped. */
static cberg_status fs_walk_entry(const char *abs, const char *rel, const char *name, cberg_fs_walk_fn fn, void *ctx, cberg_fs_skip_dir_fn skip_dir, void *skip_ctx) {
    char child_abs[PATH_MAX];
    char child_rel[PATH_MAX];
    if (!cberg_path_join(abs, name, child_abs, sizeof(child_abs)) || !cberg_path_join(rel, name, child_rel, sizeof(child_rel))) {
        return CBERG_OK;
    }

    struct stat stbuf;
    if (stat(child_abs, &stbuf) != 0) {
        return CBERG_OK;
    }

    if (S_ISDIR(stbuf.st_mode)) {
        return cberg_fs_walk(child_abs, child_rel, fn, ctx, skip_dir, skip_ctx);
    }
    if (S_ISREG(stbuf.st_mode)) {
        return fn(ctx, child_abs, child_rel, CBERG_FS_FILE);
    }
    return CBERG_OK;
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
    while (st == CBERG_OK && (ent = readdir(dir)) != NULL) {
        char child_rel[PATH_MAX];
        if (dirent_dot(ent->d_name) || !cberg_path_join(rel, ent->d_name, child_rel, sizeof(child_rel))) {
            continue;
        }

        if (skip_dir != NULL && skip_dir(ent->d_name, child_rel, skip_ctx)) {
            continue;
        }
        st = fs_walk_entry(abs, rel, ent->d_name, fn, ctx, skip_dir, skip_ctx);
    }

    closedir(dir);
    return st;
}

typedef struct {
    const char *root;
    const cberg_exclusions *exclusions;
    cberg_walk_files_fn fn;
    void *ctx;
} walk_files_state;

static int walk_files_dir(const walk_files_state *w, const char *rel);

/* Visits one directory entry of cberg_fs_walk_files. Symlinks are not
 * followed (lstat); skipped directories, special files, and entries too deep
 * to address or that cannot be inspected are left out. */
static int walk_files_entry(const walk_files_state *w, const char *rel, const char *name) {
    char child_rel[PATH_MAX];
    if (rel[0] == '\0') {
        snprintf(child_rel, sizeof(child_rel), "%s", name);
    } else {
        snprintf(child_rel, sizeof(child_rel), "%s/%s", rel, name);
    }

    char abspath[PATH_MAX];
    struct stat st;
    if (!cberg_path_join(w->root, child_rel, abspath, sizeof(abspath)) || lstat(abspath, &st) != 0) {
        return 0;
    }

    if (S_ISDIR(st.st_mode)) {
        bool skip = cberg_walk_skip_dir(name) || cberg_walk_excluded(w->exclusions, child_rel);
        return skip ? 0 : walk_files_dir(w, child_rel);
    }
    if (S_ISREG(st.st_mode)) {
        return w->fn(abspath, child_rel, w->ctx) != 0 ? -1 : 0;
    }
    return 0;
}

static int walk_files_dir(const walk_files_state *w, const char *rel) {
    char dirpath[PATH_MAX];
    if (rel[0] == '\0') {
        snprintf(dirpath, sizeof(dirpath), "%s", w->root);
    } else {
        snprintf(dirpath, sizeof(dirpath), "%s/%s", w->root, rel);
    }

    /* Only an unreadable root fails the walk. A subdirectory that vanished or
     * denies access is skipped, matching cberg_fs_walk: one locked folder must
     * not hide the rest of the tree. */
    DIR *d = opendir(dirpath);
    if (d == NULL) {
        return rel[0] == '\0' && errno != ENOENT ? -1 : 0;
    }

    int rc = 0;
    struct dirent *ent;
    while (rc == 0 && (ent = readdir(d)) != NULL) {
        if (!dirent_dot(ent->d_name)) {
            rc = walk_files_entry(w, rel, ent->d_name) != 0 ? -1 : 0;
        }
    }

    closedir(d);
    return rc;
}

int cberg_fs_walk_files(const char *root, const cberg_exclusions *exclusions, cberg_walk_files_fn fn, void *ctx) {
    if (root == NULL || fn == NULL) {
        return -1;
    }

    walk_files_state w = {.root = root, .exclusions = exclusions, .fn = fn, .ctx = ctx};
    return walk_files_dir(&w, "");
}
