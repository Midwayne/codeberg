#include "http_client.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef CBERG_WITH_CURL
#include <curl/curl.h>
#endif

#ifndef CBERG_WITH_CURL
#include <netdb.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#endif

void cberg_http_response_free(cberg_http_response *resp) {
    if (resp == NULL) {
        return;
    }
    free(resp->body);
    resp->body = NULL;
    resp->body_len = 0;
    resp->status = 0;
}

#ifdef CBERG_WITH_CURL

typedef struct curl_buf {
    char *data;
    size_t len;
} curl_buf;

static size_t curl_write(void *ptr, size_t size, size_t nmemb, void *userdata) {
    curl_buf *buf = userdata;
    size_t add = size * nmemb;
    char *grown = realloc(buf->data, buf->len + add + 1);
    if (grown == NULL) {
        return 0;
    }
    buf->data = grown;
    memcpy(buf->data + buf->len, ptr, add);
    buf->len += add;
    buf->data[buf->len] = '\0';
    return add;
}

cberg_status cberg_http_request(const char *method, const char *url, const char *api_key, const char *content_type,
                                const char *body, size_t body_len, cberg_http_response *out_resp) {
    if (method == NULL || url == NULL || out_resp == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    memset(out_resp, 0, sizeof(*out_resp));

    CURL *curl = curl_easy_init();
    if (curl == NULL) {
        return CBERG_ERR_INTERNAL;
    }

    curl_buf buf = {0};
    struct curl_slist *headers = NULL;
    if (content_type != NULL) {
        char htype[128];
        snprintf(htype, sizeof htype, "Content-Type: %s", content_type);
        headers = curl_slist_append(headers, htype);
    }
    if (api_key != NULL && api_key[0] != '\0') {
        char hkey[512];
        snprintf(hkey, sizeof hkey, "api-key: %s", api_key);
        headers = curl_slist_append(headers, hkey);
    }

    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, method);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, curl_write);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &buf);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 120L);
    if (body != NULL && body_len > 0) {
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, (long)body_len);
    }

    CURLcode rc = curl_easy_perform(curl);
    long status = 0;
    if (rc == CURLE_OK) {
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (rc != CURLE_OK) {
        free(buf.data);
        return CBERG_ERR_IO;
    }

    out_resp->status = (int)status;
    out_resp->body = buf.data;
    out_resp->body_len = buf.len;
    return CBERG_OK;
}

#else /* !CBERG_WITH_CURL */

typedef struct http_url {
    char host[256];
    char path[1024];
    int port;
} http_url;

static int parse_http_url(const char *url, http_url *out) {
    if (strncmp(url, "http://", 7) != 0) {
        return -1;
    }
    const char *rest = url + 7;
    const char *slash = strchr(rest, '/');
    const char *host_end = slash != NULL ? slash : rest + strlen(rest);
    const char *colon = memchr(rest, ':', (size_t)(host_end - rest));
    size_t host_len;
    if (colon != NULL && colon < host_end) {
        host_len = (size_t)(colon - rest);
        out->port = atoi(colon + 1);
        if (out->port <= 0) {
            return -1;
        }
    } else {
        host_len = (size_t)(host_end - rest);
        out->port = 80;
    }
    if (host_len == 0 || host_len >= sizeof(out->host)) {
        return -1;
    }
    memcpy(out->host, rest, host_len);
    out->host[host_len] = '\0';
    if (slash != NULL) {
        if (strlen(slash) >= sizeof(out->path)) {
            return -1;
        }
        strcpy(out->path, slash);
    } else {
        strcpy(out->path, "/");
    }
    return 0;
}

static int connect_host(const char *host, int port) {
    char port_s[16];
    snprintf(port_s, sizeof port_s, "%d", port);
    struct addrinfo hints = {0};
    hints.ai_socktype = SOCK_STREAM;
    struct addrinfo *res = NULL;
    if (getaddrinfo(host, port_s, &hints, &res) != 0 || res == NULL) {
        return -1;
    }
    int fd = -1;
    for (struct addrinfo *ai = res; ai != NULL; ai = ai->ai_next) {
        fd = (int)socket(ai->ai_family, ai->ai_socktype, ai->ai_protocol);
        if (fd < 0) {
            continue;
        }
        if (connect(fd, ai->ai_addr, ai->ai_addrlen) == 0) {
            break;
        }
        close(fd);
        fd = -1;
    }
    freeaddrinfo(res);
    return fd;
}

static cberg_status read_http_response(int fd, cberg_http_response *out_resp) {
    char *buf = NULL;
    size_t cap = 0;
    size_t len = 0;
    char chunk[4096];
    for (;;) {
        ssize_t n = read(fd, chunk, sizeof chunk);
        if (n < 0) {
            free(buf);
            return CBERG_ERR_IO;
        }
        if (n == 0) {
            break;
        }
        if (len + (size_t)n + 1 > cap) {
            size_t new_cap = cap == 0 ? 4096 : cap * 2;
            while (new_cap < len + (size_t)n + 1) {
                new_cap *= 2;
            }
            char *grown = realloc(buf, new_cap);
            if (grown == NULL) {
                free(buf);
                return CBERG_ERR_OUT_OF_MEMORY;
            }
            buf = grown;
            cap = new_cap;
        }
        memcpy(buf + len, chunk, (size_t)n);
        len += (size_t)n;
    }
    if (buf != NULL) {
        buf[len] = '\0';
    }

    out_resp->status = 0;
    out_resp->body = NULL;
    out_resp->body_len = 0;
    if (len == 0) {
        free(buf);
        return CBERG_ERR_IO;
    }

    const char *sep = strstr(buf, "\r\n\r\n");
    if (sep == NULL) {
        free(buf);
        return CBERG_ERR_IO;
    }
    if (sscanf(buf, "HTTP/%*s %d", &out_resp->status) != 1) {
        free(buf);
        return CBERG_ERR_IO;
    }

    const char *body = sep + 4;
    size_t body_len = len - (size_t)(body - buf);
    out_resp->body = malloc(body_len + 1);
    if (out_resp->body == NULL) {
        free(buf);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    memcpy(out_resp->body, body, body_len);
    out_resp->body[body_len] = '\0';
    out_resp->body_len = body_len;
    free(buf);
    return CBERG_OK;
}

cberg_status cberg_http_request(const char *method, const char *url, const char *api_key, const char *content_type,
                                const char *body, size_t body_len, cberg_http_response *out_resp) {
    if (method == NULL || url == NULL || out_resp == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    memset(out_resp, 0, sizeof(*out_resp));

    http_url parsed;
    if (parse_http_url(url, &parsed) != 0) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    int fd = connect_host(parsed.host, parsed.port);
    if (fd < 0) {
        return CBERG_ERR_IO;
    }

    char req[8192];
    int hdr = snprintf(req, sizeof req, "%s %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n", method, parsed.path,
                       parsed.host);
    if (hdr < 0 || (size_t)hdr >= sizeof req) {
        close(fd);
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (api_key != NULL && api_key[0] != '\0') {
        int n = snprintf(req + hdr, sizeof req - (size_t)hdr, "api-key: %s\r\n", api_key);
        if (n < 0 || (size_t)hdr + (size_t)n >= sizeof req) {
            close(fd);
            return CBERG_ERR_INVALID_ARGUMENT;
        }
        hdr += n;
    }
    if (content_type != NULL) {
        int n = snprintf(req + hdr, sizeof req - (size_t)hdr, "Content-Type: %s\r\n", content_type);
        if (n < 0 || (size_t)hdr + (size_t)n >= sizeof req) {
            close(fd);
            return CBERG_ERR_INVALID_ARGUMENT;
        }
        hdr += n;
    }
    if (body != NULL && body_len > 0) {
        int n = snprintf(req + hdr, sizeof req - (size_t)hdr, "Content-Length: %zu\r\n\r\n", body_len);
        if (n < 0 || (size_t)hdr + (size_t)n + body_len >= sizeof req) {
            close(fd);
            return CBERG_ERR_INVALID_ARGUMENT;
        }
        hdr += n;
        memcpy(req + hdr, body, body_len);
        hdr += (int)body_len;
    } else {
        int n = snprintf(req + hdr, sizeof req - (size_t)hdr, "Content-Length: 0\r\n\r\n");
        if (n < 0 || (size_t)hdr + (size_t)n >= sizeof req) {
            close(fd);
            return CBERG_ERR_INVALID_ARGUMENT;
        }
        hdr += n;
    }

    size_t sent = 0;
    while (sent < (size_t)hdr) {
        ssize_t n = write(fd, req + sent, (size_t)hdr - sent);
        if (n <= 0) {
            close(fd);
            return CBERG_ERR_IO;
        }
        sent += (size_t)n;
    }

    cberg_status st = read_http_response(fd, out_resp);
    close(fd);
    return st;
}

#endif /* CBERG_WITH_CURL */
