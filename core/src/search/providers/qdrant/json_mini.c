#include "json_mini.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

static const char *json_skip_ws(const char *p) {
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
    p = json_skip_ws(p);
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
    if ((p = json_skip_literal(p, "true")) != NULL) {
        return p;
    }
    if ((p = json_skip_literal(p, "false")) != NULL) {
        return p;
    }
    if ((p = json_skip_literal(p, "null")) != NULL) {
        return p;
    }
    return NULL;
}

static const char *json_object_find(const char *obj, const char *key) {
    obj = json_skip_ws(obj);
    if (obj == NULL || *obj != '{') {
        return NULL;
    }
    obj++;
    for (;;) {
        obj = json_skip_ws(obj);
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
        obj = json_skip_ws(after_key);
        if (obj == NULL || *obj != ':') {
            return NULL;
        }
        obj = json_skip_ws(obj + 1);
        if (strlen(key) == key_len && strncmp(key_content, key, key_len) == 0) {
            return obj;
        }
        obj = json_skip_value(obj);
        if (obj == NULL) {
            return NULL;
        }
        obj = json_skip_ws(obj);
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

static const char *cberg_json_get_path(const char *root, const char *path) {
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
    p = json_skip_ws(p);
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
    p = json_skip_ws(p);
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
    p = json_skip_ws(p);
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

static int json_object_read_key(const char *obj, const char *key, const char **out_value) {
    const char *v = json_object_find(obj, key);
    if (v == NULL) {
        return -1;
    }
    *out_value = v;
    return 0;
}

int cberg_json_parse_qdrant_hits(const char *body, size_t k, uint64_t *out_ids, float *out_scores,
                                 size_t *out_found) {
    if (body == NULL || out_ids == NULL || out_scores == NULL || out_found == NULL) {
        return -1;
    }
    *out_found = 0;
    const char *result = json_object_find(body, "result");
    if (result == NULL) {
        return -1;
    }
    result = json_skip_ws(result);
    if (result == NULL || *result != '[') {
        return -1;
    }
    result++;
    size_t found = 0;
    for (;;) {
        result = json_skip_ws(result);
        if (result == NULL) {
            return -1;
        }
        if (*result == ']') {
            break;
        }
        if (*result != '{') {
            return -1;
        }
        const char *id_val = NULL;
        const char *score_val = NULL;
        if (json_object_read_key(result, "id", &id_val) != 0) {
            return -1;
        }
        if (json_object_read_key(result, "score", &score_val) != 0) {
            return -1;
        }
        if (found < k) {
            uint64_t id = 0;
            double score = 0.0;
            if (cberg_json_read_uint64(id_val, &id) != 0 || cberg_json_read_double(score_val, &score) != 0) {
                return -1;
            }
            out_ids[found] = id;
            out_scores[found] = (float)score;
            found++;
        }
        result = json_skip_value(result);
        if (result == NULL) {
            return -1;
        }
        result = json_skip_ws(result);
        if (result == NULL) {
            return -1;
        }
        if (*result == ']') {
            break;
        }
        if (*result != ',') {
            return -1;
        }
        result++;
    }
    *out_found = found;
    return 0;
}

int cberg_json_qdrant_points_nonempty(const char *body) {
    const char *result = json_object_find(body, "result");
    if (result == NULL) {
        return 0;
    }
    result = json_skip_ws(result);
    if (result == NULL || *result != '[') {
        return 0;
    }
    result = json_skip_ws(result + 1);
    return result != NULL && *result != ']';
}

int cberg_json_qdrant_collection_dim(const char *body, int *out_dim) {
    if (body == NULL || out_dim == NULL) {
        return -1;
    }
    const char *size =
        cberg_json_get_path(body, "result.config.params.vectors.size");
    if (size == NULL) {
        /* Older / alternate Qdrant layouts nest size directly under vectors. */
        const char *vectors = cberg_json_get_path(body, "result.config.params.vectors");
        if (vectors == NULL) {
            return -1;
        }
        size = json_object_find(vectors, "size");
    }
    if (size == NULL) {
        return -1;
    }
    return cberg_json_read_int(size, out_dim);
}
