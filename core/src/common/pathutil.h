#ifndef CBERG_PATHUTIL_H
#define CBERG_PATHUTIL_H

#include <stdbool.h>
#include <stddef.h>

/* True for directory names that should never be watched or walked. */
bool cberg_path_skip_dir(const char *name);

/* Join root and rel into out (NUL-terminated). Returns false on overflow. */
bool cberg_path_join(const char *root, const char *rel, char *out, size_t out_cap);

#endif /* CBERG_PATHUTIL_H */
