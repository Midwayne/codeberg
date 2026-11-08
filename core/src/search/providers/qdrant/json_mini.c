#include "json_mini.h"
#include "json_read.h"

#include <stddef.h>

static int json_object_read_key(const char *obj, const char *key, const char **out_value) {
    const char *v = cberg_json_object_field(obj, key);
    if (v == NULL) {
        return -1;
    }
    *out_value = v;
    return 0;
}

int cberg_json_parse_qdrant_hits(const char *body, size_t k, uint64_t *out_ids, float *out_scores, size_t *out_found) {
    if (body == NULL || out_ids == NULL || out_scores == NULL || out_found == NULL) {
        return -1;
    }
    *out_found = 0;
    const char *result = cberg_json_object_field(body, "result");
    if (result == NULL) {
        return -1;
    }
    result = cberg_json_skip_ws(result);
    if (result == NULL || *result != '[') {
        return -1;
    }
    result++;
    size_t found = 0;
    for (;;) {
        result = cberg_json_skip_ws(result);
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
        result = cberg_json_skip(result);
        if (result == NULL) {
            return -1;
        }
        result = cberg_json_skip_ws(result);
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
        size = cberg_json_object_field(vectors, "size");
    }
    if (size == NULL) {
        return -1;
    }
    return cberg_json_read_int(size, out_dim);
}
