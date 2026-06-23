#define _POSIX_C_SOURCE 200809L

#include "ipc.h"
#include "indexer.h"

#include <errno.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

typedef struct cberg_ipc_server {
    cberg_indexer *idx;
    int listen_fd;
    pthread_t thread;
} cberg_ipc_server;

static int write_all(int fd, const char *buf, size_t len) {
    size_t off = 0;
    while (off < len) {
        ssize_t n = write(fd, buf + off, len - off);
        if (n <= 0) {
            return -1;
        }
        off += (size_t)n;
    }
    return 0;
}

static void handle_client(cberg_indexer *idx, int fd) {
    char line[8192];
    ssize_t n = read(fd, line, sizeof(line) - 1);
    if (n <= 0) {
        return;
    }
    line[n] = '\0';
    char *nl = strchr(line, '\n');
    if (nl != NULL) {
        *nl = '\0';
    }

    if (strcmp(line, "status") == 0) {
        pthread_mutex_lock(&idx->mu);
        int ready = idx->ready;
        pthread_mutex_unlock(&idx->mu);
        char resp[512];
        snprintf(resp, sizeof(resp),
                 "{\"ok\":true,\"ready\":%s,\"chunks\":%zu,\"version\":\"%s\"}\n", ready ? "true" : "false",
                 cberg_indexer_chunk_count(idx), cberg_indexer_version());
        write_all(fd, resp, strlen(resp));
        return;
    }

    if (strncmp(line, "search\t", 7) == 0) {
        char *query = line + 7;
        char *tab = strrchr(query, '\t');
        size_t k = 10;
        if (tab != NULL) {
            *tab = '\0';
            k = (size_t)atoi(tab + 1);
            if (k == 0) {
                k = 10;
            }
        }
        uint64_t ids[64];
        float scores[64];
        size_t found = 0;
        size_t want = k > 64 ? 64 : k;
        cberg_status st = cberg_indexer_search(idx, query, want, ids, scores, &found);
        if (st != CBERG_OK) {
            char resp[256];
            snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"%s\"}\n", cberg_status_str(st));
            write_all(fd, resp, strlen(resp));
            return;
        }
        char resp[16384];
        size_t off = snprintf(resp, sizeof(resp), "{\"ok\":true,\"results\":[");
        for (size_t i = 0; i < found && off + 64 < sizeof(resp); i++) {
            if (i > 0) {
                resp[off++] = ',';
            }
            int w = snprintf(resp + off, sizeof(resp) - off, "{\"id\":%llu,\"score\":%.6f}",
                             (unsigned long long)ids[i], (double)scores[i]);
            if (w < 0) {
                break;
            }
            off += (size_t)w;
        }
        snprintf(resp + off, sizeof(resp) - off, "]}\n");
        write_all(fd, resp, strlen(resp));
        return;
    }

    char err[128];
    snprintf(err, sizeof(err), "{\"ok\":false,\"error\":\"unknown command\"}\n");
    write_all(fd, err, strlen(err));
}

static void *ipc_thread(void *arg) {
    cberg_ipc_server *srv = arg;
    for (;;) {
        if (srv->idx->stop) {
            break;
        }
        int client = accept(srv->listen_fd, NULL, NULL);
        if (client < 0) {
            if (errno == EINTR) {
                continue;
            }
            break;
        }
        handle_client(srv->idx, client);
        close(client);
    }
    return NULL;
}

int cberg_ipc_start(cberg_indexer *idx, cberg_ipc_server **out) {
    cberg_ipc_server *srv = calloc(1, sizeof(*srv));
    if (srv == NULL) {
        return -1;
    }
    srv->idx = idx;

    unlink(idx->socket_path);
    srv->listen_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (srv->listen_fd < 0) {
        free(srv);
        return -1;
    }

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, idx->socket_path, sizeof(addr.sun_path) - 1);

    if (bind(srv->listen_fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        close(srv->listen_fd);
        free(srv);
        return -1;
    }
    if (listen(srv->listen_fd, 8) != 0) {
        close(srv->listen_fd);
        unlink(idx->socket_path);
        free(srv);
        return -1;
    }

    if (pthread_create(&srv->thread, NULL, ipc_thread, srv) != 0) {
        close(srv->listen_fd);
        unlink(idx->socket_path);
        free(srv);
        return -1;
    }

    *out = srv;
    return 0;
}

void cberg_ipc_stop(cberg_ipc_server *srv) {
    if (srv == NULL) {
        return;
    }
    srv->idx->stop = 1;
    close(srv->listen_fd);
    pthread_join(srv->thread, NULL);
    unlink(srv->idx->socket_path);
    free(srv);
}
