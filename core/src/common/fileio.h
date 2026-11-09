#ifndef CBERG_FILEIO_H
#define CBERG_FILEIO_H

#include <stddef.h>

/*
 * Reads an entire file into a malloc'd buffer. Writes the byte length to *out_len
 * and NUL-terminates at buf[*out_len]. Returns NULL on failure; caller frees.
 */
char *cberg_read_file(const char *path, size_t *out_len);

/*
 * Copy the module path from a go.mod body. The module clause must be the first
 * statement. Leading // and block comments are skipped. A surrounding quote and
 * a trailing comment are not part of the path. Returns 1 and writes a non-empty
 * path, or 0 and an empty string.
 */
int cberg_go_module_path(const char *body, char *out, size_t out_cap);

/* True when import is the module path or a package path under it. */
int cberg_go_module_owns_import(const char *module, const char *import_path);

#endif /* CBERG_FILEIO_H */
