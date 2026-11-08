#ifndef CBERG_IPC_JSON_H
#define CBERG_IPC_JSON_H

#include <stddef.h>
#include <stdint.h>

/*
 * Growable JSON response buffer for IPC replies. Every append grows the
 * buffer, so a reply is never clipped by its size; on allocation failure the
 * buffer is marked failed and later appends are ignored, and the caller sends
 * an "out of memory" error instead of a partial document.
 *
 * Field writers take `sep` (',' or 0) so callers compose objects without
 * splicing already-encoded text.
 */
typedef struct ipc_json {
    char *data;
    size_t len;
    size_t cap;
    int failed;
} ipc_json;

void ipc_json_init(ipc_json *j);
void ipc_json_free(ipc_json *j);

void ipc_json_raw(ipc_json *j, const char *s);
void ipc_json_appendf(ipc_json *j, const char *fmt, ...) __attribute__((format(printf, 2, 3)));

/* Writes a quoted JSON string: `n` bytes of `s`, or "" when s is NULL. */
void ipc_json_strn(ipc_json *j, const char *s, size_t n);
void ipc_json_str(ipc_json *j, const char *s);

void ipc_json_field_str(ipc_json *j, char sep, const char *key, const char *value);
void ipc_json_field_u64(ipc_json *j, char sep, const char *key, uint64_t value);
void ipc_json_field_bool(ipc_json *j, char sep, const char *key, int value);

#endif
