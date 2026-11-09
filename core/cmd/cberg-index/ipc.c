#define _POSIX_C_SOURCE 200809L
#ifdef __APPLE__
#define _DARWIN_C_SOURCE 1
#endif

#include "ipc.h"
#include "ipc_internal.h"

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

/*
 * The command handlers keep their result arrays on the stack (a full trace is
 * CBERG_TRACE_MAX edges of ~2 KB each, an outline CBERG_OUTLINE_MAX hits).
 * That overflows macOS's 512 KB default secondary-thread stack (Linux defaults
 * to ~8 MB, which is why it only faulted on macOS, as a SIGBUS in
 * ___chkstk_darwin). Give the thread an explicit, generous stack rather than
 * relying on the platform default.
 */
#define IPC_THREAD_STACK_SIZE (8u * 1024u * 1024u)

/* One request line, including its newline, must fit in this many bytes. */
#define IPC_REQUEST_MAX 8191

typedef struct cberg_ipc_server {
    cberg_engine *eng;
    atomic_int listen_fd;
    char socket_path[sizeof(((struct sockaddr_un *)0)->sun_path)];
    int status_only;
    struct cberg_ipc_server *health;
    int lock_fd;
    atomic_int stopping;
    pthread_t thread;
} cberg_ipc_server;

/* A client that hangs up early (e.g. a daemon request timing out) must cost
 * that one reply, not raise SIGPIPE and kill the whole indexer. macOS lacks
 * MSG_NOSIGNAL and sets SO_NOSIGPIPE on the accepted socket instead. */
#ifdef MSG_NOSIGNAL
#define IPC_SEND_FLAGS MSG_NOSIGNAL
#else
#define IPC_SEND_FLAGS 0
#endif

/* Reads one request. Returns 0 with the newline stripped, -1 when the peer
 * sent nothing, or -2 when the line does not fit in cap-1 bytes. Further
 * bytes already queued are assembled; a peer that stops without a newline is
 * accepted, so a short command is never blocked on a second read. */
static int read_request(int fd, char *buf, size_t cap) {
    size_t off = 0;

    for (;;) {
        if (off + 1 >= cap) {
            return -2;
        }
        if (off > 0) {
            struct pollfd waiting = {.fd = fd, .events = POLLIN};
            int ready = poll(&waiting, 1, 0);
            if (ready <= 0) {
                break;
            }
        }

        ssize_t n = read(fd, buf + off, cap - 1 - off);
        if (n < 0 && errno == EINTR) {
            continue;
        }
        if (n <= 0) {
            break;
        }

        off += (size_t)n;
        buf[off] = '\0';
        if (strchr(buf, '\n') != NULL) {
            break;
        }
    }

    if (off == 0) {
        return -1;
    }

    char *nl = strchr(buf, '\n');
    if (nl != NULL) {
        *nl = '\0';
    }
    return 0;
}

int cberg_ipc_write_all(int fd, const char *buf, size_t len) {
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

static void handle_client(cberg_engine *eng, int fd, int status_only) {
    struct pollfd pfd = {.fd = fd, .events = POLLIN};
    int pr = poll(&pfd, 1, 5000);
    if (pr <= 0) {
        return;
    }
    char line[IPC_REQUEST_MAX + 1];
    int rr = read_request(fd, line, sizeof(line));
    if (rr == -1) {
        return;
    }
    if (rr == -2) {
        cberg_ipc_send_error(fd, cberg_status_code(CBERG_ERR_INVALID_ARGUMENT), "request too long");
        return;
    }

    if (strcmp(line, "status") == 0) {
        cberg_ipc_status(eng, fd);
        return;
    }

    if (status_only) {
        cberg_ipc_send_error(fd, cberg_status_code(CBERG_ERR_INVALID_ARGUMENT), "health socket accepts status only");
        return;
    }

    /* No tool queues behind a build: a busy engine answers with a fallback hint. */
    if (!cberg_engine_begin_query(eng)) {
        cberg_ipc_send_error(fd, "not_ready",
                             "index building; use grep, glob or read_file while indexing and graph creation finish");
        return;
    }

    cberg_ipc_dispatch(eng, fd, line);
    cberg_engine_end_query(eng);
}

static void *ipc_thread(void *arg) {
    cberg_ipc_server *srv = arg;
    for (;;) {
        if (atomic_load(&srv->stopping)) {
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
            if (atomic_load(&srv->stopping) || srv->listen_fd < 0) {
                break;
            }
            continue;
        }
        /* A lazily restarted embedding worker must not retain client sockets. */
        if (fcntl(client, F_SETFD, FD_CLOEXEC) != 0) {
            close(client);
            continue;
        }
#ifdef SO_NOSIGPIPE
        int one = 1;
        setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
#endif
        handle_client(srv->eng, client, srv->status_only);
        close(client);
    }
    return NULL;
}

static int ipc_start_at(cberg_engine *eng, const char *socket_path, int status_only, cberg_ipc_server **out) {
    cberg_ipc_server *srv = calloc(1, sizeof(*srv));
    if (srv == NULL) {
        return -1;
    }
    if (strlen(socket_path) >= sizeof(srv->socket_path)) {
        free(srv);
        return -1;
    }
    strcpy(srv->socket_path, socket_path);
    srv->status_only = status_only;
    atomic_init(&srv->listen_fd, -1);
    atomic_init(&srv->stopping, 0);
    srv->eng = eng;

    /* Serialize owners even during startup. Leave the lock file in place so a
     * waiting launcher never locks a different inode after it is removed. */
    size_t lock_len = strlen(socket_path) + sizeof(".lock");
    char *lock_path = malloc(lock_len);
    if (lock_path == NULL) {
        free(srv);
        return -1;
    }
    snprintf(lock_path, lock_len, "%s.lock", socket_path);
    srv->lock_fd = open(lock_path, O_CREAT | O_RDWR | O_CLOEXEC, 0600);
    free(lock_path);
    if (srv->lock_fd < 0) {
        free(srv);
        return -1;
    }
    if (flock(srv->lock_fd, LOCK_EX | LOCK_NB) != 0) {
        close(srv->lock_fd);
        free(srv);
        return -1;
    }

    struct stat st;
    if (lstat(socket_path, &st) == 0) {
        if (!S_ISSOCK(st.st_mode)) {
            close(srv->lock_fd);
            free(srv);
            return -1;
        }
        int probe = socket(AF_UNIX, SOCK_STREAM, 0);
        struct sockaddr_un existing;
        memset(&existing, 0, sizeof(existing));
        existing.sun_family = AF_UNIX;
        strncpy(existing.sun_path, socket_path, sizeof(existing.sun_path) - 1);
        int connected = probe >= 0 && connect(probe, (struct sockaddr *)&existing, sizeof(existing)) == 0;
        int probe_errno = errno;
        if (probe >= 0)
            close(probe);
        if (connected || probe < 0 || probe_errno != ECONNREFUSED || unlink(socket_path) != 0) {
            close(srv->lock_fd);
            free(srv);
            return -1;
        }
    } else if (errno != ENOENT) {
        close(srv->lock_fd);
        free(srv);
        return -1;
    }
    srv->listen_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (srv->listen_fd < 0 || fcntl(srv->listen_fd, F_SETFD, FD_CLOEXEC) != 0) {
        if (srv->listen_fd >= 0)
            close(srv->listen_fd);
        close(srv->lock_fd);
        free(srv);
        return -1;
    }

    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, socket_path, sizeof(addr.sun_path) - 1);

    if (bind(srv->listen_fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        close(srv->listen_fd);
        close(srv->lock_fd);
        free(srv);
        return -1;
    }
    if (listen(srv->listen_fd, 8) != 0) {
        close(srv->listen_fd);
        unlink(socket_path);
        close(srv->lock_fd);
        free(srv);
        return -1;
    }

    pthread_attr_t attr;
    pthread_attr_t *attrp = NULL;
    if (pthread_attr_init(&attr) == 0) {
        pthread_attr_setstacksize(&attr, IPC_THREAD_STACK_SIZE);
        attrp = &attr;
    }
    int rc = pthread_create(&srv->thread, attrp, ipc_thread, srv);
    if (attrp != NULL) {
        pthread_attr_destroy(attrp);
    }
    if (rc != 0) {
        close(srv->listen_fd);
        unlink(socket_path);
        close(srv->lock_fd);
        free(srv);
        return -1;
    }

    *out = srv;
    return 0;
}

int cberg_ipc_start(cberg_engine *eng, cberg_ipc_server **out) {
    cberg_ipc_server *srv = NULL;
    if (ipc_start_at(eng, eng->socket_path, 0, &srv) != 0) {
        return -1;
    }

    char health_path[sizeof(srv->socket_path) + sizeof(".health")];
    snprintf(health_path, sizeof(health_path), "%s.health", eng->socket_path);
    if (strlen(health_path) >= sizeof(srv->socket_path)) {
        fprintf(stderr, "cberg-index: socket path too long for independent health listener; shorten CBERG_SOCKET\n");
        *out = srv;
        return 0;
    }
    if (ipc_start_at(eng, health_path, 1, &srv->health) != 0) {
        cberg_ipc_stop(srv);
        return -1;
    }

    *out = srv;
    return 0;
}

void cberg_ipc_stop(cberg_ipc_server *srv) {
    if (srv == NULL) {
        return;
    }
    cberg_ipc_stop(srv->health);
    atomic_store(&srv->stopping, 1);
    int fd = srv->listen_fd;
    srv->listen_fd = -1;
    if (fd >= 0) {
        shutdown(fd, SHUT_RDWR);
        close(fd);
    }
    pthread_join(srv->thread, NULL);
    unlink(srv->socket_path);
    close(srv->lock_fd);
    free(srv);
}
