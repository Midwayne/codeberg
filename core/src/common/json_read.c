#include "json_read.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

const char *cberg_json_skip_ws(const char *p) {
    while (p != NULL && *p != '\0' && isspace((unsigned char)*p)) {
        p++;
    }
    return p;
}

static const char *json_skip_value(const char *p);

static const char *json_skip_string(const char *p) {
    if (p == NULL || *p != '"') {
        return NULL;
    }
    p++;
    while (*p != '\0') {
        if (*p == '\\') {
            p++;
            if (*p == '\0') {
                return NULL;
            }
        } else if (*p == '"') {
            return p + 1;
        }
        p++;
    }
    return NULL;
}

static const char *json_skip_number(const char *p) {
    if (p == NULL || *p == '\0') {
        return NULL;
    }
    if (*p == '-') {
        p++;
    }
    while (*p != '\0' && isdigit((unsigned char)*p)) {
        p++;
    }
    if (*p == '.') {
        p++;
        while (*p != '\0' && isdigit((unsigned char)*p)) {
            p++;
        }
    }
    if (*p == 'e' || *p == 'E') {
        p++;
        if (*p == '+' || *p == '-') {
            p++;
        }
        while (*p != '\0' && isdigit((unsigned char)*p)) {
            p++;
        }
    }
    return p;
}

static const char *json_skip_literal(const char *p, const char *lit) {
    size_t n = strlen(lit);
    if (p == NULL || strncmp(p, lit, n) != 0) {
        return NULL;
    }
    return p + n;
}

static const char *json_skip_container(const char *p, char open, char close) {
    if (p == NULL || *p != open) {
        return NULL;
    }
    int depth = 0;
    int in_string = 0;
    for (; *p != '\0'; p++) {
        if (in_string) {
            if (*p == '\\') {
                p++;
                if (*p == '\0')
                    return NULL;
                continue;
            }
            if (*p == '"') {
                in_string = 0;
            }
            continue;
        }
        if (*p == '"') {
            in_string = 1;
            continue;
        }
        if (*p == open) {
            depth++;
        } else if (*p == close) {
            depth--;
            if (depth == 0) {
                return p + 1;
            }
        }
    }
    return NULL;
}

static const char *json_skip_value(const char *p) {
    p = cberg_json_skip_ws(p);
    if (p == NULL || *p == '\0') {
        return NULL;
    }
    if (*p == '"') {
        return json_skip_string(p);
    }
    if (*p == '{') {
        return json_skip_container(p, '{', '}');
    }
    if (*p == '[') {
        return json_skip_container(p, '[', ']');
    }
    if (*p == '-' || isdigit((unsigned char)*p)) {
        return json_skip_number(p);
    }
    const char *literal = json_skip_literal(p, "true");
    if (literal != NULL)
        return literal;
    literal = json_skip_literal(p, "false");
    if (literal != NULL)
        return literal;
    literal = json_skip_literal(p, "null");
    if (literal != NULL)
        return literal;
    return NULL;
}

static const char *json_object_find(const char *obj, const char *key) {
    obj = cberg_json_skip_ws(obj);
    if (obj == NULL || *obj != '{') {
        return NULL;
    }
    obj++;
    for (;;) {
        obj = cberg_json_skip_ws(obj);
        if (obj == NULL) {
            return NULL;
        }
        if (*obj == '}') {
            return NULL;
        }
        if (*obj != '"') {
            return NULL;
        }
        const char *key_content = obj + 1;
        const char *after_key = json_skip_string(obj);
        if (after_key == NULL) {
            return NULL;
        }
        size_t key_len = (size_t)(after_key - key_content - 1);
        obj = cberg_json_skip_ws(after_key);
        if (obj == NULL || *obj != ':') {
            return NULL;
        }
        obj = cberg_json_skip_ws(obj + 1);
        if (strlen(key) == key_len && strncmp(key_content, key, key_len) == 0) {
            return obj;
        }
        obj = json_skip_value(obj);
        if (obj == NULL) {
            return NULL;
        }
        obj = cberg_json_skip_ws(obj);
        if (obj == NULL) {
            return NULL;
        }
        if (*obj == '}') {
            return NULL;
        }
        if (*obj != ',') {
            return NULL;
        }
        obj++;
    }
}

const char *cberg_json_get_path(const char *root, const char *path) {
    if (root == NULL || path == NULL || path[0] == '\0') {
        return NULL;
    }
    const char *cur = root;
    const char *seg = path;
    char key[128];
    for (;;) {
        const char *dot = strchr(seg, '.');
        size_t len = dot != NULL ? (size_t)(dot - seg) : strlen(seg);
        if (len == 0 || len >= sizeof(key)) {
            return NULL;
        }
        memcpy(key, seg, len);
        key[len] = '\0';
        cur = json_object_find(cur, key);
        if (cur == NULL) {
            return NULL;
        }
        if (dot == NULL) {
            return cur;
        }
        seg = dot + 1;
    }
}

int cberg_json_read_int(const char *p, int *out) {
    if (out == NULL) {
        return -1;
    }
    p = cberg_json_skip_ws(p);
    if (p == NULL) {
        return -1;
    }
    char *end = NULL;
    long v = strtol(p, &end, 10);
    if (end == p) {
        return -1;
    }
    *out = (int)v;
    return 0;
}

int cberg_json_read_uint64(const char *p, uint64_t *out) {
    if (out == NULL) {
        return -1;
    }
    p = cberg_json_skip_ws(p);
    if (p == NULL) {
        return -1;
    }
    char *end = NULL;
    unsigned long long v = strtoull(p, &end, 10);
    if (end == p) {
        return -1;
    }
    *out = (uint64_t)v;
    return 0;
}

int cberg_json_read_double(const char *p, double *out) {
    if (out == NULL) {
        return -1;
    }
    p = cberg_json_skip_ws(p);
    if (p == NULL) {
        return -1;
    }
    char *end = NULL;
    double v = strtod(p, &end);
    if (end == p) {
        return -1;
    }
    *out = v;
    return 0;
}

const char *cberg_json_skip(const char *p) {
    return json_skip_value(cberg_json_skip_ws(p));
}

const char *cberg_json_object_field(const char *object, const char *key) {
    return key != NULL ? json_object_find(object, key) : NULL;
}

int cberg_json_string_copy(const char *value, char *out, size_t capacity) {
    value = cberg_json_skip_ws(value);
    const char *end = json_skip_string(value);
    if (end == NULL || out == NULL || capacity == 0)
        return -1;

    size_t length = (size_t)(end - value - 2);
    if (length >= capacity || memchr(value + 1, '\\', length) != NULL)
        return -1;
    memcpy(out, value + 1, length);
    out[length] = '\0';
    return 0;
}
