#ifndef CBERG_HTTP_CLIENT_H
#define CBERG_HTTP_CLIENT_H

#include <stddef.h>

#include "codeberg/codeberg.h"

typedef struct cberg_http_response {
    int status;
    char *body;
    size_t body_len;
} cberg_http_response;

void cberg_http_response_free(cberg_http_response *resp);

/*
 * Issues an HTTP request. `url` must be http:// or https:// when libcurl is
 * available; without curl only http:// is supported.
 */
cberg_status cberg_http_request(const char *method, const char *url, const char *api_key, const char *content_type, const char *body, size_t body_len, cberg_http_response *out_resp);

#endif /* CBERG_HTTP_CLIENT_H */
