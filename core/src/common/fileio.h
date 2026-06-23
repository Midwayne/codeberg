#ifndef CBERG_FILEIO_H
#define CBERG_FILEIO_H

#include <stddef.h>

/*
 * Reads an entire file into a malloc'd buffer. Writes the byte length to *out_len
 * and NUL-terminates at buf[*out_len]. Returns NULL on failure; caller frees.
 */
char *cberg_read_file(const char *path, size_t *out_len);

#endif /* CBERG_FILEIO_H */
