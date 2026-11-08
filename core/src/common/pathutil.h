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

/*
 * The repository tree walk shared by the manifest, the watchers, the indexer,
 * and the import resolver, so they all see the same files:
 *   - symlinks are not followed (lstat), so walks cannot cycle or leave the root;
 *   - directories named by cberg_walk_skip_dir are pruned (files are never);
 *   - entries that vanish mid-walk and unreadable subdirectories are skipped;
 *     only an unreadable start directory is an error (CBERG_ERR_IO).
 * fn sees the start directory and every directory as CBERG_FS_DIR before its
 * contents. A non-OK status from fn stops the walk and is returned.
 */
cberg_status cberg_fs_walk(const char *abs, const char *rel, cberg_fs_walk_fn fn, void *ctx);

typedef int (*cberg_walk_files_fn)(const char *abs, const char *rel, void *ctx);

/* cberg_fs_walk over regular files only; fn returning non-zero stops the walk.
 * Returns 0 on a complete walk, -1 otherwise. */
int cberg_fs_walk_files(const char *root, cberg_walk_files_fn fn, void *ctx);

#endif /* CBERG_PATHUTIL_H */
