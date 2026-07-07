#ifndef CBERG_WALK_POLICY_H
#define CBERG_WALK_POLICY_H

#include <stdbool.h>

/*
 * Returns non-zero when a directory basename should be excluded from repository
 * tree walks (.git, node_modules, …). Shared by the manifest, watcher, and indexer.
 */
int cberg_walk_skip_dir(const char *name);

/* cberg_fs_walk skip callback wrapping cberg_walk_skip_dir. */
bool cberg_walk_skip_dir_cb(const char *name, void *ctx);

#endif /* CBERG_WALK_POLICY_H */
