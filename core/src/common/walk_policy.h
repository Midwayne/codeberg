#ifndef CBERG_WALK_POLICY_H
#define CBERG_WALK_POLICY_H

#include <stdbool.h>

/*
 * Returns non-zero when a directory basename should be excluded from repository
 * tree walks (.git, node_modules, …). Shared by the manifest, watcher, and indexer.
 */
int cberg_walk_skip_dir(const char *name);

/*
 * Returns true when a root-relative path lies under a skipped directory, so
 * watch events match what a tree walk would see. The last component counts
 * only when `is_dir` says it names a directory.
 */
bool cberg_walk_skip_rel(const char *rel, bool is_dir);

#endif /* CBERG_WALK_POLICY_H */
