#ifndef CBERG_WALK_POLICY_H
#define CBERG_WALK_POLICY_H

#include <stdbool.h>

#include "codeberg/codeberg.h"

/*
 * Returns non-zero when a directory basename should be excluded from repository
 * tree walks (.git, node_modules, …). Shared by the manifest, watcher, and indexer.
 */
int cberg_walk_skip_dir(const char *name);

/* True when root-relative `rel` is one of `exclusions` or lies inside one.
 * NULL or empty exclusions exclude nothing. */
bool cberg_walk_excluded(const cberg_exclusions *exclusions, const char *rel);

/* cberg_fs_walk skip callback: the basename policy plus the exclusions in
 * `ctx` (a const cberg_exclusions *, or NULL). `rel` is the directory's
 * root-relative path. */
bool cberg_walk_skip_dir_cb(const char *name, const char *rel, void *ctx);

#endif /* CBERG_WALK_POLICY_H */
