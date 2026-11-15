#define _POSIX_C_SOURCE 200809L

#include "ipc_internal.h"

#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>

/* A client that hangs up early (e.g. a daemon request timing out) must cost
 * that one reply, not raise SIGPIPE and kill the whole indexer. macOS lacks
 * MSG_NOSIGNAL and sets SO_NOSIGPIPE on the accepted socket instead. */
#ifdef MSG_NOSIGNAL
#define IPC_SEND_FLAGS MSG_NOSIGNAL
#else
#define IPC_SEND_FLAGS 0
#endif

int ipc_write_all(int fd, const char *buf, size_t len) {
    size_t off = 0;
    while (off < len) {
        ssize_t n = send(fd, buf + off, len - off, IPC_SEND_FLAGS);
        if (n < 0 && errno == EINTR) {
            continue;
        }
        if (n <= 0) {
            return -1;
        }
        off += (size_t)n;
    }
    return 0;
}

void ipc_send_error(int fd, const char *message) {
    char resp[512];
    snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"%s\"}\n", message);
    ipc_write_all(fd, resp, strlen(resp));
}

/* JSON strings may not carry raw control characters; the daemon's decoder
 * rejects the whole response if one slips through (form feeds in C sources,
 * ANSI escapes in logs). Escapes are never split when out fills up. */
void ipc_json_escape(const char *in, char *out, size_t cap) {
    size_t j = 0;
    for (size_t i = 0; in[i] != '\0'; i++) {
        unsigned char c = (unsigned char)in[i];
        char esc[8];
        size_t n = 0;

        if (c == '"' || c == '\\') {
            n = (size_t)snprintf(esc, sizeof(esc), "\\%c", c);
        } else if (c == '\n') {
            n = (size_t)snprintf(esc, sizeof(esc), "\\n");
        } else if (c == '\r') {
            n = (size_t)snprintf(esc, sizeof(esc), "\\r");
        } else if (c == '\t') {
            n = (size_t)snprintf(esc, sizeof(esc), "\\t");
        } else if (c < 0x20) {
            n = (size_t)snprintf(esc, sizeof(esc), "\\u%04x", c);
        } else {
            esc[0] = (char)c;
            n = 1;
        }

        if (j + n >= cap) {
            break;
        }
        memcpy(out + j, esc, n);
        j += n;
    }
    out[j] = '\0';
}

/* Appends formatted text at *off only when all of it fits before cap; on
 * overflow resp is left as it was and 0 is returned, so lists end on a whole
 * item instead of a clipped one (or past the buffer). */
int ipc_appendf(char *resp, size_t cap, size_t *off, const char *fmt, ...) {
    if (*off >= cap) {
        return 0;
    }

    va_list ap;
    va_start(ap, fmt);
    int w = vsnprintf(resp + *off, cap - *off, fmt, ap);
    va_end(ap);

    if (w < 0 || (size_t)w >= cap - *off) {
        resp[*off] = '\0';
        return 0;
    }
    *off += (size_t)w;
    return 1;
}

size_t ipc_list_cap(size_t resp_size) {
    return resp_size - IPC_TAIL_RESERVE;
}

/* Starts list item i: writes the separator and remembers where the item began
 * so a failed write can roll back. */
size_t ipc_list_item_begin(char *resp, size_t cap, size_t *off, size_t i) {
    size_t mark = *off;
    if (i > 0) {
        ipc_appendf(resp, cap, off, ",");
    }
    return mark;
}

void ipc_list_item_rollback(char *resp, size_t *off, size_t mark) {
    *off = mark;
    resp[mark] = '\0';
}

char *ipc_next_field(char **cursor) {
    if (cursor == NULL || *cursor == NULL || **cursor == '\0') {
        return NULL;
    }
    char *start = *cursor;
    char *tab = strchr(start, '\t');
    if (tab != NULL) {
        *tab = '\0';
        *cursor = tab + 1;
    } else {
        *cursor = start + strlen(start);
    }
    return start;
}

char *ipc_null_if_empty(char *field) {
    return (field != NULL && field[0] == '\0') ? NULL : field;
}

size_t ipc_count_field(const char *field, size_t fallback) {
    if (field == NULL || field[0] == '\0') {
        return fallback;
    }

    size_t count = (size_t)atoi(field);
    return count == 0 ? fallback : count;
}

size_t ipc_clamp_want(size_t limit, size_t cap) {
    return limit > cap ? cap : limit;
}

/* True when the stack/response cap may have clipped results the caller asked for. */
int ipc_cap_truncated(size_t found, size_t want, size_t limit, size_t cap) {
    return found >= want && (limit > cap || found >= cap);
}
