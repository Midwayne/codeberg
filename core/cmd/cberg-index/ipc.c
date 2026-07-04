#define _POSIX_C_SOURCE 200809L

#include "ipc.h"
#include "indexer.h"

#include <errno.h>
#include <poll.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

typedef struct cberg_ipc_server {
    cberg_engine *eng;
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

static void json_escape(const char *in, char *out, size_t cap) {
    size_t j = 0;
    for (size_t i = 0; in[i] != '\0' && j + 2 < cap; i++) {
        char c = in[i];
        if (c == '"' || c == '\\') {
            out[j++] = '\\';
        }
        if (c == '\n') {
            out[j++] = '\\';
            c = 'n';
        } else if (c == '\r') {
            out[j++] = '\\';
            c = 'r';
        } else if (c == '\t') {
            out[j++] = '\\';
            c = 't';
        }
        out[j++] = c;
    }
    out[j] = '\0';
}

static void handle_status(cberg_engine *eng, int fd) {
    /* ready = the bootstrap pass finished and at least one repo is searchable;
     * the per-repo list tells consumers exactly which (a failed repo stays
     * ready:false without holding the whole daemon unhealthy). */
    size_t ready_repos = 0;
    for (size_t i = 0; i < eng->repos_len; i++) {
        if (cberg_repo_ready(eng->repos[i])) {
            ready_repos++;
        }
    }
    int ready = eng->bootstrapped && ready_repos > 0;

    char resp[8192];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"ready\":%s,\"chunks\":%zu,\"version\":\"%s\",\"repos\":[",
                                  ready ? "true" : "false", cberg_engine_chunk_count(eng), cberg_indexer_version());
    for (size_t i = 0; i < eng->repos_len && off + 512 < sizeof(resp); i++) {
        cberg_repo *r = eng->repos[i];
        char esc_key[256];
        json_escape(r->key, esc_key, sizeof(esc_key));
        int w = snprintf(resp + off, sizeof(resp) - off, "%s{\"key\":\"%s\",\"ready\":%s,\"chunks\":%zu}",
                         i > 0 ? "," : "", esc_key, cberg_repo_ready(r) ? "true" : "false",
                         cberg_repo_chunk_count(r));
        if (w < 0) {
            break;
        }
        off += (size_t)w;
    }
    snprintf(resp + off, sizeof(resp) - off, "]}\n");
    write_all(fd, resp, strlen(resp));
}

static void handle_search(cberg_engine *eng, int fd, char *args) {
    /* Fields, tab-separated left to right: <query> [\t <k> [\t <repo>]]. The
     * daemon strips tabs from queries, so the first tab ends the query; the
     * repo field is optional for compatibility with the 3-field form. */
    char *query = args;
    size_t k = 10;
    const char *repo = NULL;
    char *tab = strchr(query, '\t');
    if (tab != NULL) {
        *tab = '\0';
        char *kstr = tab + 1;
        char *tab2 = strchr(kstr, '\t');
        if (tab2 != NULL) {
            *tab2 = '\0';
            if (tab2[1] != '\0') {
                repo = tab2 + 1;
            }
        }
        k = (size_t)atoi(kstr);
        if (k == 0) {
            k = 10;
        }
    }

    cberg_engine_hit hits[64];
    size_t found = 0;
    size_t want = k > 64 ? 64 : k;
    cberg_status st = cberg_engine_search_hits(eng, query, repo, want, hits, 64, &found);
    if (st != CBERG_OK) {
        char resp[256];
        snprintf(resp, sizeof(resp), "{\"ok\":false,\"error\":\"%s\"}\n", cberg_status_str(st));
        write_all(fd, resp, strlen(resp));
        return;
    }
    char resp[32768];
    size_t off = (size_t)snprintf(resp, sizeof(resp), "{\"ok\":true,\"results\":[");
    for (size_t i = 0; i < found && off + 512 < sizeof(resp); i++) {
        if (i > 0) {
            resp[off++] = ',';
        }
        char esc_repo[256];
        char esc_path[512];
        char esc_symbol[256];
        char esc_snippet[CBERG_SNIPPET_MAX * 2];
        json_escape(hits[i].repo != NULL ? hits[i].repo : "", esc_repo, sizeof(esc_repo));
        json_escape(hits[i].path, esc_path, sizeof(esc_path));
        json_escape(hits[i].symbol, esc_symbol, sizeof(esc_symbol));
        json_escape(hits[i].snippet, esc_snippet, sizeof(esc_snippet));
        int w = snprintf(resp + off, sizeof(resp) - off,
                         "{\"id\":%llu,\"score\":%.6f,\"repo\":\"%s\",\"path\":\"%s\",\"symbol\":\"%s\","
                         "\"start_line\":%u,\"end_line\":%u,\"snippet\":\"%s\"}",
                         (unsigned long long)hits[i].id, (double)hits[i].score, esc_repo, esc_path, esc_symbol,
                         hits[i].start_line, hits[i].end_line, esc_snippet);
        if (w < 0) {
            break;
        }
        off += (size_t)w;
    }
    snprintf(resp + off, sizeof(resp) - off, "]}\n");
    write_all(fd, resp, strlen(resp));
}

static void handle_client(cberg_engine *eng, int fd) {
    struct pollfd pfd = {.fd = fd, .events = POLLIN};
    int pr = poll(&pfd, 1, 5000);
    if (pr <= 0) {
        return;
    }
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
        handle_status(eng, fd);
        return;
    }

    if (strncmp(line, "search\t", 7) == 0) {
        handle_search(eng, fd, line + 7);
        return;
    }

    char err[128];
    snprintf(err, sizeof(err), "{\"ok\":false,\"error\":\"unknown command\"}\n");
    write_all(fd, err, strlen(err));
}

static void *ipc_thread(void *arg) {
    cberg_ipc_server *srv = arg;
    for (;;) {
        if (srv->eng->stop) {
            break;
        }
        int listen_fd = srv->listen_fd;
        if (listen_fd < 0) {
            break;
        }
        struct pollfd pfd = {.fd = listen_fd, .events = POLLIN};
        int pr = poll(&pfd, 1, 200);
        if (pr < 0) {
            if (errno == EINTR) {
                continue;
            }
            break;
        }
        if (pr == 0) {
            continue;
        }
        int client = accept(listen_fd, NULL, NULL);
        if (client < 0) {
            if (errno == EINTR) {
                continue;
            }
            if (srv->eng->stop || srv->listen_fd < 0) {
                break;
            }
            continue;
        }
        handle_client(srv->eng, client);
        close(client);
    }
    return NULL;
}

int cberg_ipc_start(cberg_engine *eng, cberg_ipc_server **out) {
    cberg_ipc_server *srv = calloc(1, sizeof(*srv));
    if (srv == NULL) {
        return -1;
    }
    srv->eng = eng;

    unlink(eng->socket_path);
    srv->listen_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (srv->listen_fd < 0) {
        free(srv);
        return -1;
    }

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, eng->socket_path, sizeof(addr.sun_path) - 1);

    if (bind(srv->listen_fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        close(srv->listen_fd);
        free(srv);
        return -1;
    }
    if (listen(srv->listen_fd, 8) != 0) {
        close(srv->listen_fd);
        unlink(eng->socket_path);
        free(srv);
        return -1;
    }

    if (pthread_create(&srv->thread, NULL, ipc_thread, srv) != 0) {
        close(srv->listen_fd);
        unlink(eng->socket_path);
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
    srv->eng->stop = 1;
    int fd = srv->listen_fd;
    srv->listen_fd = -1;
    if (fd >= 0) {
        shutdown(fd, SHUT_RDWR);
        close(fd);
    }
    pthread_join(srv->thread, NULL);
    unlink(srv->eng->socket_path);
    free(srv);
}
