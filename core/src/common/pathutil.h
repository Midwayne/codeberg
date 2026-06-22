#ifndef CBERG_PATHUTIL_H
#define CBERG_PATHUTIL_H

#include "codeberg/codeberg.h"

#include <stdbool.h>
#include <stddef.h>

/* True for directory names that should never be watched or walked. */
bool cberg_path_skip_dir(const char *name);

/* Join root and rel into out (NUL-terminated). Returns false on overflow. */
bool cberg_path_join(const char *root, const char *rel, char *out, size_t out_cap);

/* realpath into out. */
cberg_status cberg_path_resolve(const char *path, char *out, size_t out_cap);

typedef enum cberg_fs_entry_kind {
    CBERG_FS_DIR,
    CBERG_FS_FILE,
} cberg_fs_entry_kind;

typedef cberg_status (*cberg_fs_walk_fn)(void *ctx, const char *abs, const char *rel, cberg_fs_entry_kind kind);

/* Depth-first walk; skips dot dirs and cberg_path_skip_dir names. */
cberg_status cberg_fs_walk(const char *abs, const char *rel, cberg_fs_walk_fn fn, void *ctx);

#endif /* CBERG_PATHUTIL_H */
