#include "ipc_json.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "grow.h"

void ipc_json_init(ipc_json *j) {
    memset(j, 0, sizeof(*j));
}

void ipc_json_free(ipc_json *j) {
    free(j->data);
    memset(j, 0, sizeof(*j));
}

/* Ensures room for `extra` more bytes plus the terminating NUL. */
static int reserve(ipc_json *j, size_t extra) {
    if (j->failed) {
        return 0;
    }

    if (extra > SIZE_MAX - j->len - 1) {
        j->failed = 1;
        return 0;
    }

    size_t want = j->len + extra + 1;
    if (want <= j->cap) {
        return 1;
    }

    size_t next = cberg_grow_cap(j->cap, want, 4096);
    char *grown = realloc(j->data, next);
    if (grown == NULL) {
        j->failed = 1;
        return 0;
    }

    j->data = grown;
    j->cap = next;
    return 1;
}

static void put(ipc_json *j, const char *s, size_t n) {
    if (!reserve(j, n)) {
        return;
    }

    memcpy(j->data + j->len, s, n);
    j->len += n;
    j->data[j->len] = '\0';
}

void ipc_json_raw(ipc_json *j, const char *s) {
    put(j, s, strlen(s));
}

void ipc_json_appendf(ipc_json *j, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int need = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);

    if (need < 0) {
        j->failed = 1;
        return;
    }
    if (!reserve(j, (size_t)need)) {
        return;
    }

    va_start(ap, fmt);
    vsnprintf(j->data + j->len, (size_t)need + 1, fmt, ap);
    va_end(ap);
    j->len += (size_t)need;
}

/* JSON strings may not carry raw control characters; the daemon's decoder
 * rejects the whole response if one slips through (form feeds in C sources,
 * ANSI escapes in logs, NUL bytes in binary-ish files). */
void ipc_json_strn(ipc_json *j, const char *s, size_t n) {
    put(j, "\"", 1);

    size_t run = 0;
    for (size_t i = 0; s != NULL && i < n; i++) {
        unsigned char c = (unsigned char)s[i];
        if (c >= 0x20 && c != '"' && c != '\\') {
            continue;
        }

        put(j, s + run, i - run);
        run = i + 1;

        char esc[8];
        if (c == '"' || c == '\\') {
            snprintf(esc, sizeof(esc), "\\%c", c);
        } else if (c == '\n') {
            snprintf(esc, sizeof(esc), "\\n");
        } else if (c == '\r') {
            snprintf(esc, sizeof(esc), "\\r");
        } else if (c == '\t') {
            snprintf(esc, sizeof(esc), "\\t");
        } else {
            snprintf(esc, sizeof(esc), "\\u%04x", c);
        }
        ipc_json_raw(j, esc);
    }
    if (s != NULL) {
        put(j, s + run, n - run);
    }

    put(j, "\"", 1);
}

void ipc_json_str(ipc_json *j, const char *s) {
    ipc_json_strn(j, s, s != NULL ? strlen(s) : 0);
}

static void key(ipc_json *j, char sep, const char *name) {
    if (sep != 0) {
        put(j, &sep, 1);
    }
    ipc_json_str(j, name);
    put(j, ":", 1);
}

void ipc_json_field_str(ipc_json *j, char sep, const char *name, const char *value) {
    key(j, sep, name);
    ipc_json_str(j, value);
}

void ipc_json_field_u64(ipc_json *j, char sep, const char *name, uint64_t value) {
    key(j, sep, name);
    ipc_json_appendf(j, "%llu", (unsigned long long)value);
}

void ipc_json_field_bool(ipc_json *j, char sep, const char *name, int value) {
    key(j, sep, name);
    ipc_json_raw(j, value ? "true" : "false");
}
