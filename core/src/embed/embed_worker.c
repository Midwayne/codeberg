#define _POSIX_C_SOURCE 200809L

#include "codeberg/codeberg.h"

#include <stdint.h>
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
} worker_impl;

void cberg_worker_close(void *handle) {
    worker_impl *w = handle;
    if (w == NULL) return;
    if (w->input != NULL) fclose(w->input);
    if (w->output != NULL) fclose(w->output);
    if (w->pid > 0) (void)waitpid(w->pid, NULL, 0);
    free(w);
}

cberg_status cberg_worker_open(const cberg_embed_config *cfg, void **out, size_t *dim) {
    const char *script = getenv("CBERG_EMBED_WORKER");
    const char *backend = getenv("CBERG_EMBED_BACKEND");
    const char *python = getenv("CBERG_EMBED_PYTHON");
    if (cfg->model_path == NULL || script == NULL || backend == NULL) return CBERG_ERR_INVALID_ARGUMENT;
    if (python == NULL || python[0] == '\0') python = "python3";
    int to_child[2], from_child[2];
    if (pipe(to_child) != 0) return CBERG_ERR_IO;
    if (pipe(from_child) != 0) {
        close(to_child[0]); close(to_child[1]);
        return CBERG_ERR_IO;
    }
    pid_t pid = fork();
    if (pid == 0) {
        dup2(to_child[0], STDIN_FILENO);
        dup2(from_child[1], STDOUT_FILENO);
        close(to_child[0]); close(to_child[1]);
        close(from_child[0]); close(from_child[1]);
        execlp(python, python, script, backend, cfg->model_path, (char *)NULL);
        _exit(127);
    }
    close(to_child[0]); close(from_child[1]);
    if (pid < 0) {
        close(to_child[1]); close(from_child[0]);
        return CBERG_ERR_IO;
    }
    worker_impl *w = calloc(1, sizeof(*w));
    if (w == NULL) {
        close(to_child[1]); close(from_child[0]);
        (void)waitpid(pid, NULL, 0);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    w->pid = pid;
    w->input = fdopen(to_child[1], "wb");
    w->output = fdopen(from_child[0], "rb");
    if (w->input == NULL || w->output == NULL) {
        if (w->input == NULL) close(to_child[1]);
        if (w->output == NULL) close(from_child[0]);
        cberg_worker_close(w);
        return CBERG_ERR_IO;
    }
    char line[64];
    unsigned long n = 0;
    if (fgets(line, sizeof(line), w->output) == NULL || sscanf(line, "READY %lu", &n) != 1 || n == 0 || n > 16384) {
        cberg_worker_close(w);
        return CBERG_ERR_IO;
    }
    w->dim = (size_t)n;
    *out = w;
    *dim = w->dim;
    return CBERG_OK;
}

cberg_status cberg_worker_embed(void *handle, const char *const *texts, const size_t *lens, size_t count, float *out) {
    worker_impl *w = handle;
    if (count > UINT32_MAX) return CBERG_ERR_INVALID_ARGUMENT;
    uint32_t n = (uint32_t)count;
    if (fwrite(&n, sizeof(n), 1, w->input) != 1) return CBERG_ERR_IO;
    for (size_t i = 0; i < count; i++) {
        if (lens[i] > UINT32_MAX) return CBERG_ERR_INVALID_ARGUMENT;
        uint32_t len = (uint32_t)lens[i];
        if (fwrite(&len, sizeof(len), 1, w->input) != 1 || fwrite(texts[i], 1, len, w->input) != len) return CBERG_ERR_IO;
    }
    if (fflush(w->input) != 0 || fread(out, sizeof(float), count * w->dim, w->output) != count * w->dim) return CBERG_ERR_IO;
    for (size_t i = 0; i < count; i++) cberg_l2_normalize(out + i * w->dim, w->dim);
    return CBERG_OK;
}
