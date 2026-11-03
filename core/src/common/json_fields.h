#ifndef CBERG_JSON_FIELDS_H
#define CBERG_JSON_FIELDS_H

#include <stddef.h>

/* Private manifest views, borrowed from a NUL-terminated input buffer.
 * String copy rejects escapes/overlong values instead of guessing a path. */
const char *cberg_json_object_field(const char *object, const char *key);
int cberg_json_string_copy(const char *value, char *out, size_t capacity);

#endif
