#define _POSIX_C_SOURCE 200809L

#include "codeberg/codeberg.h"

#include <stdint.h>
#include <pthread.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#include "embed_internal.h"

typedef struct {
    FILE *input;
    FILE *output;
    pid_t pid;
    size_t dim;
    int task_protocol;
} worker_impl;

void cberg_worker_close(void *handle) {
    worker_impl *w = handle;
    if (w == NULL) {
        return;
    }

    if (w->input != NULL) {
        fclose(w->input);
    }
    if (w->output != NULL) {
        fclose(w->output);
    }
    if (w->pid > 0) {
        (void)waitpid(w->pid, NULL, 0);
    }
    free(w);
}

static void close_pair(int a, int b) {
    close(a);
    close(b);
}

/* Starts `python script backend model` with pipes to its stdin and from its
 * stdout. On success *to_fd and *from_fd are the parent's ends. */
static cberg_status spawn_worker(const char *python, const char *script, const char *backend, const char *model, pid_t *out_pid, int *to_fd, int *from_fd) {
    int to_child[2];
    int from_child[2];
    if (pipe(to_child) != 0) {
        return CBERG_ERR_IO;
    }
    if (pipe(from_child) != 0) {
        close_pair(to_child[0], to_child[1]);
        return CBERG_ERR_IO;
    }

    pid_t pid = fork();
    if (pid == 0) {
        dup2(to_child[0], STDIN_FILENO);
        dup2(from_child[1], STDOUT_FILENO);
        close_pair(to_child[0], to_child[1]);
        close_pair(from_child[0], from_child[1]);
        execlp(python, python, script, backend, model, (char *)NULL);
        _exit(127);
    }

    close_pair(to_child[0], from_child[1]);
    if (pid < 0) {
        close_pair(to_child[1], from_child[0]);
        return CBERG_ERR_IO;
    }

    *out_pid = pid;
    *to_fd = to_child[1];
    *from_fd = from_child[0];
    return CBERG_OK;
}

/* Wraps the child's pipes as unbuffered input and buffered output streams.
 * Takes ownership of pid and both fds either way. */
static cberg_status worker_wrap(pid_t pid, int to_fd, int from_fd, const char *backend, worker_impl **out) {
    worker_impl *w = calloc(1, sizeof(*w));
    if (w == NULL) {
        close_pair(to_fd, from_fd);
        (void)waitpid(pid, NULL, 0);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    w->pid = pid;
    w->task_protocol = strcmp(backend, "sentence-transformers") == 0 || strcmp(backend, "gemma-mlx") == 0;
    w->input = fdopen(to_fd, "wb");
    w->output = fdopen(from_fd, "rb");
    if (w->input == NULL || w->output == NULL) {
        if (w->input == NULL) {
            close(to_fd);
        }
        if (w->output == NULL) {
            close(from_fd);
        }
        cberg_worker_close(w);
        return CBERG_ERR_IO;
    }

    setvbuf(w->input, NULL, _IONBF, 0);
    *out = w;
    return CBERG_OK;
}

/* The worker announces "READY <dim>" once its model is loaded. */
static cberg_status read_ready(worker_impl *w) {
    char line[64];
    unsigned long n = 0;
    if (fgets(line, sizeof(line), w->output) == NULL || sscanf(line, "READY %lu", &n) != 1 || n == 0 || n > 16384) {
        return CBERG_ERR_IO;
    }

    w->dim = (size_t)n;
    return CBERG_OK;
}

cberg_status cberg_worker_open(const cberg_embed_config *cfg, void **out, size_t *dim) {
    const char *script = getenv("CBERG_EMBED_WORKER");
    const char *backend = getenv("CBERG_EMBED_BACKEND");
    const char *python = getenv("CBERG_EMBED_PYTHON");
    if (cfg->model_path == NULL || script == NULL || backend == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (python == NULL || python[0] == '\0') {
        python = "python3";
    }

    pid_t pid = 0;
    int to_fd = -1;
    int from_fd = -1;
    worker_impl *w = NULL;
    cberg_status st = spawn_worker(python, script, backend, cfg->model_path, &pid, &to_fd, &from_fd);
    if (st == CBERG_OK) {
        st = worker_wrap(pid, to_fd, from_fd, backend, &w);
    }
    if (st != CBERG_OK) {
        return st;
    }

    st = read_ready(w);
    if (st != CBERG_OK) {
        cberg_worker_close(w);
        return st;
    }

    *out = w;
    *dim = w->dim;
    return CBERG_OK;
}

/* Writes one request: the count (high bit set for a query under the task
 * protocol), then each text as a length-prefixed byte string. */
static cberg_status write_request(worker_impl *w, const char *const *texts, const size_t *lens, size_t count, int query) {
    uint32_t n = (uint32_t)count;

    /* Only the new runtime understands task modes; existing workers retain
     * their count-only protocol even when called through semantic search. */
    if (w->task_protocol && query) {
        n |= UINT32_C(0x80000000);
    }
    if (fwrite(&n, sizeof(n), 1, w->input) != 1) {
        return CBERG_ERR_IO;
    }

    for (size_t i = 0; i < count; i++) {
        if (lens[i] > UINT32_MAX) {
            return CBERG_ERR_INVALID_ARGUMENT;
        }
        uint32_t len = (uint32_t)lens[i];
        if (fwrite(&len, sizeof(len), 1, w->input) != 1 || fwrite(texts[i], 1, len, w->input) != len) {
            return CBERG_ERR_IO;
        }
    }
    return fflush(w->input) == 0 ? CBERG_OK : CBERG_ERR_IO;
}

/* Sends texts and reads back count L2-normalized vectors. */
static cberg_status worker_roundtrip(worker_impl *w, const char *const *texts, const size_t *lens, size_t count, int query, float *out) {
    cberg_status status = write_request(w, texts, lens, count, query);
    if (status != CBERG_OK) {
        return status;
    }

    if (fread(out, sizeof(float), count * w->dim, w->output) != count * w->dim) {
        return CBERG_ERR_IO;
    }
    for (size_t i = 0; i < count; i++) {
        cberg_l2_normalize(out + i * w->dim, w->dim);
    }
    return CBERG_OK;
}

cberg_status cberg_worker_embed(void *handle, const char *const *texts, const size_t *lens, size_t count, int query, float *out) {
    worker_impl *w = handle;
    if (count > (w->task_protocol ? UINT32_MAX >> 1 : UINT32_MAX)) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    /* A failed worker closes its pipe; return IO instead of letting SIGPIPE
     * terminate the entire indexer. Block only in this calling thread. */
    sigset_t blocked;
    sigset_t old;
    sigset_t before;
    sigset_t after;
    sigemptyset(&blocked);
    sigaddset(&blocked, SIGPIPE);
    if (pthread_sigmask(SIG_BLOCK, &blocked, &old) != 0) {
        return CBERG_ERR_IO;
    }
    sigpending(&before);

    cberg_status status = worker_roundtrip(w, texts, lens, count, query, out);

    /* Consume a SIGPIPE this call raised, so unblocking does not deliver it. */
    sigpending(&after);
    if (!sigismember(&before, SIGPIPE) && sigismember(&after, SIGPIPE)) {
        int caught;
        sigwait(&blocked, &caught);
    }
    pthread_sigmask(SIG_SETMASK, &old, NULL);
    return status;
}
