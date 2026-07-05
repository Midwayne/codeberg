#include "../provider.h"
#include "../common.h"

#include "http_client.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "strutil.h"

typedef struct qdrant_backend {
    char *base_url;
    char *api_key;
    char *collection;
    size_t dim;
} qdrant_backend;

static char *join_url(const char *base, const char *suffix) {
    size_t blen = strlen(base);
    size_t slen = strlen(suffix);
    int trail = blen > 0 && base[blen - 1] == '/';
    size_t need = blen + slen + (trail ? 0 : 1) + 1;
    char *out = malloc(need);
    if (out == NULL) {
        return NULL;
    }
    if (trail) {
        snprintf(out, need, "%s%s", base, suffix);
    } else {
        snprintf(out, need, "%s/%s", base, suffix);
    }
    return out;
}

static int json_find_int(const char *body, const char *key, int *out) {
    char pattern[64];
    snprintf(pattern, sizeof pattern, "\"%s\":", key);
    const char *p = strstr(body, pattern);
    if (p == NULL) {
        return -1;
    }
    p += strlen(pattern);
    while (*p == ' ' || *p == '\t') {
        p++;
    }
    return sscanf(p, "%d", out) == 1 ? 0 : -1;
}

static void qdrant_backend_destroy(void *impl) {
    qdrant_backend *b = impl;
    if (b == NULL) {
        return;
    }
    free(b->base_url);
    free(b->api_key);
    free(b->collection);
    free(b);
}

static cberg_status qdrant_request(qdrant_backend *b, const char *method, const char *suffix, const char *body,
                                   size_t body_len, int *out_status, char **out_body) {
    char *url = join_url(b->base_url, suffix);
    if (url == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    cberg_http_response resp = {0};
    cberg_status st = cberg_http_request(method, url, b->api_key, "application/json", body, body_len, &resp);
    free(url);
    if (st != CBERG_OK) {
        return st;
    }
    if (out_status != NULL) {
        *out_status = resp.status;
    }
    if (out_body != NULL) {
        *out_body = resp.body;
        resp.body = NULL;
    } else {
        free(resp.body);
    }
    return CBERG_OK;
}

static cberg_status qdrant_delete_collection(qdrant_backend *b) {
    char suffix[512];
    snprintf(suffix, sizeof suffix, "collections/%s", b->collection);
    int status = 0;
    cberg_status st = qdrant_request(b, "DELETE", suffix, NULL, 0, &status, NULL);
    if (st != CBERG_OK) {
        return st;
    }
    if (status == 404) {
        return CBERG_OK;
    }
    if (status < 200 || status >= 300) {
        return CBERG_ERR_IO;
    }
    return CBERG_OK;
}

static cberg_status qdrant_create_collection(qdrant_backend *b) {
    char suffix[512];
    snprintf(suffix, sizeof suffix, "collections/%s", b->collection);
    char body[256];
    snprintf(body, sizeof body, "{\"vectors\":{\"size\":%zu,\"distance\":\"Cosine\"}}", b->dim);
    int status = 0;
    cberg_status st = qdrant_request(b, "PUT", suffix, body, strlen(body), &status, NULL);
    if (st != CBERG_OK) {
        return st;
    }
    if (status == 409) {
        return CBERG_OK;
    }
    if (status < 200 || status >= 300) {
        return CBERG_ERR_IO;
    }
    return CBERG_OK;
}

static cberg_status qdrant_validate_collection(qdrant_backend *b) {
    char suffix[512];
    snprintf(suffix, sizeof suffix, "collections/%s", b->collection);
    int status = 0;
    char *body = NULL;
    cberg_status st = qdrant_request(b, "GET", suffix, NULL, 0, &status, &body);
    if (st != CBERG_OK) {
        return st;
    }
    if (status == 404) {
        free(body);
        return qdrant_create_collection(b);
    }
    if (status < 200 || status >= 300) {
        free(body);
        return CBERG_ERR_IO;
    }
    int dim = 0;
    if (json_find_int(body, "size", &dim) != 0 || (size_t)dim != b->dim) {
        free(body);
        return CBERG_ERR_IO;
    }
    free(body);
    return CBERG_OK;
}

static cberg_status qdrant_backend_add(void *impl, uint64_t id, const float *vector, size_t dim) {
    qdrant_backend *b = impl;
    if (b == NULL || vector == NULL || dim != b->dim) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    char suffix[512];
    snprintf(suffix, sizeof suffix, "collections/%s/points?wait=true", b->collection);

    size_t vec_cap = dim * 16 + 64;
    char *body = malloc(vec_cap);
    if (body == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t pos = 0;
    pos += (size_t)snprintf(body + pos, vec_cap - pos, "{\"points\":[{\"id\":%llu,\"vector\":[",
                            (unsigned long long)id);
    for (size_t i = 0; i < dim; i++) {
        if (i > 0) {
            pos += (size_t)snprintf(body + pos, vec_cap - pos, ",");
        }
        pos += (size_t)snprintf(body + pos, vec_cap - pos, "%.9g", vector[i]);
        if (pos + 32 >= vec_cap) {
            size_t new_cap = vec_cap * 2;
            char *grown = realloc(body, new_cap);
            if (grown == NULL) {
                free(body);
                return CBERG_ERR_OUT_OF_MEMORY;
            }
            body = grown;
            vec_cap = new_cap;
        }
    }
    pos += (size_t)snprintf(body + pos, vec_cap - pos, "]}]}");

    int status = 0;
    cberg_status st = qdrant_request(b, "PUT", suffix, body, pos, &status, NULL);
    free(body);
    if (st != CBERG_OK) {
        return st;
    }
    if (status < 200 || status >= 300) {
        return CBERG_ERR_IO;
    }
    return CBERG_OK;
}

static cberg_status qdrant_backend_remove(void *impl, uint64_t id) {
    qdrant_backend *b = impl;
    if (b == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char suffix[512];
    snprintf(suffix, sizeof suffix, "collections/%s/points/delete?wait=true", b->collection);
    char body[64];
    snprintf(body, sizeof body, "{\"points\":[%llu]}", (unsigned long long)id);
    int status = 0;
    cberg_status st = qdrant_request(b, "POST", suffix, body, strlen(body), &status, NULL);
    if (st != CBERG_OK) {
        return st;
    }
    if (status == 404) {
        return CBERG_ERR_NOT_FOUND;
    }
    if (status < 200 || status >= 300) {
        return CBERG_ERR_IO;
    }
    return CBERG_OK;
}

static cberg_status qdrant_backend_search(void *impl, const float *query, size_t dim, size_t k,
                                          size_t expansion_search, uint64_t *out_ids, float *out_scores,
                                          size_t *out_found) {
    (void)expansion_search;
    qdrant_backend *b = impl;
    if (b == NULL || query == NULL || dim != b->dim || out_ids == NULL || out_scores == NULL || out_found == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_found = 0;

    char suffix[512];
    snprintf(suffix, sizeof suffix, "collections/%s/points/search", b->collection);

    size_t body_cap = dim * 16 + 128;
    char *body = malloc(body_cap);
    if (body == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t pos = 0;
    pos += (size_t)snprintf(body + pos, body_cap - pos, "{\"vector\":[");
    for (size_t i = 0; i < dim; i++) {
        if (i > 0) {
            pos += (size_t)snprintf(body + pos, body_cap - pos, ",");
        }
        pos += (size_t)snprintf(body + pos, body_cap - pos, "%.9g", query[i]);
    }
    pos += (size_t)snprintf(body + pos, body_cap - pos, "],\"limit\":%zu,\"with_payload\":false}", k);

    int status = 0;
    char *resp_body = NULL;
    cberg_status st = qdrant_request(b, "POST", suffix, body, pos, &status, &resp_body);
    free(body);
    if (st != CBERG_OK) {
        return st;
    }
    if (status < 200 || status >= 300) {
        free(resp_body);
        return CBERG_ERR_IO;
    }

    size_t found = 0;
    const char *cursor = resp_body;
    while (found < k) {
        const char *id_key = strstr(cursor, "\"id\":");
        const char *score_key = id_key != NULL ? strstr(id_key, "\"score\":") : NULL;
        if (id_key == NULL || score_key == NULL) {
            break;
        }
        unsigned long long rid = 0;
        float score = 0.0f;
        if (sscanf(id_key + 5, "%llu", &rid) != 1) {
            break;
        }
        if (sscanf(score_key + 8, "%f", &score) != 1) {
            break;
        }
        out_ids[found] = (uint64_t)rid;
        out_scores[found] = score;
        found++;
        cursor = score_key + 8;
    }
    free(resp_body);
    *out_found = found;
    return CBERG_OK;
}

static cberg_status qdrant_backend_save(void *impl) {
    (void)impl;
    return CBERG_OK;
}

static cberg_status qdrant_backend_clear(void *impl) {
    qdrant_backend *b = impl;
    if (b == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    cberg_status st = qdrant_delete_collection(b);
    if (st != CBERG_OK) {
        return st;
    }
    return qdrant_create_collection(b);
}

static cberg_status qdrant_open(const char *path, size_t dim, const cberg_index_config *config,
                                cberg_index_backend **out_backend) {
    if (path == NULL || dim == 0 || config == NULL || config->vectordb_url == NULL || config->vectordb_url[0] == '\0' ||
        out_backend == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_backend = NULL;

#ifndef CBERG_WITH_CURL
    if (strncmp(config->vectordb_url, "https://", 8) == 0) {
        return CBERG_ERR_NOT_IMPLEMENTED;
    }
#endif

    qdrant_backend *b = calloc(1, sizeof(*b));
    if (b == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    b->dim = dim;
    b->base_url = cberg_strdup(config->vectordb_url);
    b->collection = cberg_provider_name_from_path(path);
    if (config->vectordb_api_key != NULL && config->vectordb_api_key[0] != '\0') {
        b->api_key = cberg_strdup(config->vectordb_api_key);
    }
    if (b->base_url == NULL || b->collection == NULL) {
        qdrant_backend_destroy(b);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = qdrant_validate_collection(b);
    if (st != CBERG_OK) {
        qdrant_backend_destroy(b);
        return st;
    }

    cberg_index_backend *backend =
        cberg_index_backend_new(b, qdrant_backend_destroy, qdrant_backend_add, qdrant_backend_remove,
                                qdrant_backend_search, qdrant_backend_save, qdrant_backend_clear);
    if (backend == NULL) {
        qdrant_backend_destroy(b);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    *out_backend = backend;
    return CBERG_OK;
}

static cberg_status qdrant_wipe(const char *path, size_t dim, const cberg_index_config *config) {
    (void)dim;
    if (path == NULL || config == NULL || config->vectordb_url == NULL || config->vectordb_url[0] == '\0') {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    qdrant_backend b = {0};
    b.base_url = (char *)config->vectordb_url;
    b.api_key = (char *)(config->vectordb_api_key != NULL ? config->vectordb_api_key : "");
    b.collection = cberg_provider_name_from_path(path);
    if (b.collection == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    cberg_status st = qdrant_delete_collection(&b);
    free(b.collection);
    return st;
}

const cberg_index_provider_ops cberg_qdrant_provider = {
    .id = CBERG_INDEX_QDRANT,
    .name = "qdrant",
    .rebuild_inplace = 1,
    .open = qdrant_open,
    .wipe = qdrant_wipe,
};
