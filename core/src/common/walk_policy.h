#ifndef CBERG_WALK_POLICY_H
#define CBERG_WALK_POLICY_H

/*
 * Returns non-zero when a directory basename should be excluded from repository
 * tree walks (.git, node_modules, …). Shared by the manifest, watcher, and indexer.
 */
int cberg_walk_skip_dir(const char *name);

#endif /* CBERG_WALK_POLICY_H */
