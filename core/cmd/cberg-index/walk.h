#ifndef CBERG_WALK_H
#define CBERG_WALK_H

typedef int (*walk_fn)(const char *abs, const char *rel, void *ctx);

int cberg_walk_files(const char *root, walk_fn fn, void *ctx);

#endif
