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
 * The per-command IPC handlers keep large response buffers on the stack (up to
 * ~128 KB each, e.g. `char resp[131072]`). When the compiler inlines them into
 * handle_client/ipc_thread it does not always coalesce those slots, so the
 * thread's frame reaches ~550 KB. That overflows macOS's 512 KB default
 * secondary-thread stack (Linux defaults to ~8 MB, which is why it only faults
 * on macOS, as a SIGBUS in ___chkstk_darwin). Give the thread an explicit,
 * generous stack rather than relying on the platform default.
 */
#define IPC_THREAD_STACK_SIZE (8u * 1024u * 1024u)

#define REQUEST_TIMEOUT_MS 5000 /* how long a connected client may stay silent */
#define ACCEPT_POLL_MS 200      /* how often the accept loop rechecks stop */
#define LISTEN_BACKLOG 8

typedef struct cberg_ipc_server {
    cberg_engine *eng;
    atomic_int listen_fd;
    char socket_path[sizeof(((struct sockaddr_un *)0)->sun_path)];
    int status_only;
    struct cberg_ipc_server *health;
    int lock_fd;
    pthread_t thread;
} cberg_ipc_server;

typedef struct {
    const char *name;
    ipc_handler *handle;
    int args_optional; /* the bare command, with no fields, is also valid */
} ipc_command;

static const ipc_command COMMANDS[] = {
    {"search", ipc_handle_search, 0},
    {"chunk", ipc_handle_chunk, 0},
    {"symbol", ipc_handle_symbol, 0},
    {"outline", ipc_handle_outline, 0},
    {"search_graph", ipc_handle_search_graph, 0},
    {"trace_path", ipc_handle_trace_path, 0},
    {"graph_refs", ipc_handle_graph_refs, 0},
    {"graph_stats", ipc_handle_graph_stats, 1},
    {"graph_hubs", ipc_handle_graph_hubs, 1},
};

/* The fields that follow the command name in `line`, or NULL when the line
 * is not this command. */
static char *command_args(const ipc_command *cmd, char *line) {
    size_t name_len = strlen(cmd->name);
    if (strncmp(line, cmd->name, name_len) != 0) {
        return NULL;
    }

    if (line[name_len] == '\t') {
        return line + name_len + 1;
    }
    if (line[name_len] == '\0' && cmd->args_optional) {
        return line + name_len;
    }
    return NULL;
}

static void dispatch_command(cberg_engine *eng, int fd, char *line) {
    for (size_t i = 0; i < sizeof(COMMANDS) / sizeof(COMMANDS[0]); i++) {
        char *args = command_args(&COMMANDS[i], line);
        if (args != NULL) {
            COMMANDS[i].handle(eng, fd, args);
            return;
        }
    }

    ipc_send_error(fd, "unknown command");
}

/* Reads one request line into `line`; returns 0 when the client sent nothing
 * within the timeout. */
static int read_request(int fd, char *line, size_t cap) {
    struct pollfd pfd = {.fd = fd, .events = POLLIN};
    if (poll(&pfd, 1, REQUEST_TIMEOUT_MS) <= 0) {
        return 0;
    }

    ssize_t n = read(fd, line, cap - 1);
    if (n <= 0) {
        return 0;
    }
    line[n] = '\0';

    char *newline = strchr(line, '\n');
    if (newline != NULL) {
        *newline = '\0';
    }
    return 1;
}

static void handle_client(cberg_engine *eng, int fd, int status_only) {
    char line[8192];
    if (!read_request(fd, line, sizeof(line))) {
        return;
    }

    if (strcmp(line, "status") == 0) {
        ipc_handle_status(eng, fd);
        return;
    }

    if (status_only) {
        ipc_send_error(fd, "health socket accepts status only");
        return;
    }

    /* Bootstrap owns the repo locks; watched updates also own work_mu.
     * Acquire work_mu without waiting so no tool queues behind a build.
     * Keep it through dispatch to prevent a build starting mid-query. */
    if (!eng->bootstrapped || pthread_mutex_trylock(&eng->work_mu) != 0) {
        ipc_send_error(fd, "index building; use grep, glob or read_file while indexing and graph creation finish");
        return;
    }

    dispatch_command(eng, fd, line);
    pthread_mutex_unlock(&eng->work_mu);
}

static void serve_client(cberg_ipc_server *srv, int client) {
    /* A lazily restarted embedding worker must not retain client sockets. */
    if (fcntl(client, F_SETFD, FD_CLOEXEC) != 0) {
        return;
    }

#ifdef SO_NOSIGPIPE
    int one = 1;
    setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
#endif

    handle_client(srv->eng, client, srv->status_only);
}

static void *ipc_thread(void *arg) {
    cberg_ipc_server *srv = arg;

    while (!srv->eng->stop) {
        int listen_fd = srv->listen_fd;
        if (listen_fd < 0) {
            break;
        }

        struct pollfd pfd = {.fd = listen_fd, .events = POLLIN};
        int ready = poll(&pfd, 1, ACCEPT_POLL_MS);
        if (ready < 0 && errno != EINTR) {
            break;
        }
        if (ready <= 0) {
            continue;
        }

        int client = accept(listen_fd, NULL, NULL);
        if (client < 0) {
            if (errno != EINTR && (srv->eng->stop || srv->listen_fd < 0)) {
                break;
            }
            continue;
        }

        serve_client(srv, client);
        close(client);
    }
    return NULL;
}

/* ---------------------------------------------------------------- startup */

/* Takes the exclusive "<socket>.lock", serializing owners even during
 * startup. The lock file is left in place so a waiting launcher never locks
 * a different inode after it is removed. Returns the locked fd, or -1. */
static int lock_socket(const char *socket_path) {
    size_t lock_len = strlen(socket_path) + sizeof(".lock");
    char *lock_path = malloc(lock_len);
    if (lock_path == NULL) {
        return -1;
    }
    snprintf(lock_path, lock_len, "%s.lock", socket_path);

    int fd = open(lock_path, O_CREAT | O_RDWR | O_CLOEXEC, 0600);
    free(lock_path);
    if (fd < 0) {
        return -1;
    }

    if (flock(fd, LOCK_EX | LOCK_NB) != 0) {
        close(fd);
        return -1;
    }
    return fd;
}

static void socket_address(const char *socket_path, struct sockaddr_un *addr) {
    memset(addr, 0, sizeof(*addr));
    addr->sun_family = AF_UNIX;
    strncpy(addr->sun_path, socket_path, sizeof(addr->sun_path) - 1);
}

/* Removes a socket file left behind by a dead indexer (it refuses
 * connections). Returns -1 when the path is not a socket, something still
 * answers on it, or it cannot be removed. */
static int remove_stale_socket(const char *socket_path) {
    struct stat info;
    if (lstat(socket_path, &info) != 0) {
        return errno == ENOENT ? 0 : -1;
    }
    if (!S_ISSOCK(info.st_mode)) {
        return -1;
    }

    int probe = socket(AF_UNIX, SOCK_STREAM, 0);
    if (probe < 0) {
        return -1;
    }

    struct sockaddr_un addr;
    socket_address(socket_path, &addr);
    int connected = connect(probe, (struct sockaddr *)&addr, sizeof(addr)) == 0;
    int connect_errno = errno;
    close(probe);

    if (connected || connect_errno != ECONNREFUSED) {
        return -1;
    }
    return unlink(socket_path) == 0 ? 0 : -1;
}

/* Returns the listening fd, or -1 with nothing left behind. */
static int listen_on(const char *socket_path) {
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
        return -1;
    }

    struct sockaddr_un addr;
    socket_address(socket_path, &addr);
    if (fcntl(fd, F_SETFD, FD_CLOEXEC) != 0 || bind(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        close(fd);
        return -1;
    }

    if (listen(fd, LISTEN_BACKLOG) != 0) {
        close(fd);
        unlink(socket_path);
        return -1;
    }
    return fd;
}

static int start_thread(cberg_ipc_server *srv) {
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
    return rc;
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
    srv->eng = eng;
    atomic_init(&srv->listen_fd, -1);

    srv->lock_fd = lock_socket(socket_path);
    if (srv->lock_fd < 0) {
        free(srv);
        return -1;
    }

    if (remove_stale_socket(socket_path) != 0) {
        goto fail;
    }

    int listen_fd = listen_on(socket_path);
    if (listen_fd < 0) {
        goto fail;
    }
    srv->listen_fd = listen_fd;

    if (start_thread(srv) != 0) {
        close(listen_fd);
        unlink(socket_path);
        goto fail;
    }

    *out = srv;
    return 0;

fail:
    close(srv->lock_fd);
    free(srv);
    return -1;
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
    srv->eng->stop = 1;
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
