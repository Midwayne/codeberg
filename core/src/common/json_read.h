#ifndef CBERG_JSON_READ_H
#define CBERG_JSON_READ_H

#include <stddef.h>
#include <stdint.h>

/*
 * Minimal read-only JSON views over a NUL-terminated buffer: Qdrant REST
 * responses and package manifests. Not a general parser. Every returned
 * pointer borrows the input; NULL means absent or malformed.
 */

const char *cberg_json_skip_ws(const char *p);

/* The byte after the value starting at p (after optional whitespace). */
const char *cberg_json_skip(const char *p);

/* The value of `key` in the object at `object`. */
const char *cberg_json_object_field(const char *object, const char *key);

/* Navigates dotted paths (e.g. "result.config.params.vectors") to a value start. */
const char *cberg_json_get_path(const char *root, const char *path);

/* Reads a JSON number at `p` (after optional whitespace). Return 0 on success. */
int cberg_json_read_int(const char *p, int *out);
int cberg_json_read_uint64(const char *p, uint64_t *out);
int cberg_json_read_double(const char *p, double *out);

/* Copies a JSON string value. Rejects escapes and overlong values instead of
 * guessing a path. Returns 0 on success. */
int cberg_json_string_copy(const char *value, char *out, size_t capacity);

#endif /* CBERG_JSON_READ_H */
