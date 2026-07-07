#ifndef CBERG_PATHUTIL_H
#define CBERG_PATHUTIL_H

#include "codeberg/codeberg.h"

#include <stdbool.h>
#include <stddef.h>

bool cberg_path_join(const char *root, const char *rel, char *out, size_t out_cap);

cberg_status cberg_path_resolve(const char *path, char *out, size_t out_cap);

typedef enum cberg_fs_entry_kind {
    CBERG_FS_DIR,
    CBERG_FS_FILE,
} cberg_fs_entry_kind;

typedef cberg_status (*cberg_fs_walk_fn)(void *ctx, const char *abs, const char *rel, cberg_fs_entry_kind kind);

typedef bool (*cberg_fs_skip_dir_fn)(const char *name, void *ctx);

cberg_status cberg_fs_walk(const char *abs, const char *rel, cberg_fs_walk_fn fn, void *ctx, cberg_fs_skip_dir_fn skip_dir, void *skip_ctx);

typedef int (*cberg_walk_files_fn)(const char *abs, const char *rel, void *ctx);

/* File-only walk with lstat (no symlink follow) and indexer skip policy. */
int cberg_fs_walk_files(const char *root, cberg_walk_files_fn fn, void *ctx);

#endif /* CBERG_PATHUTIL_H */
