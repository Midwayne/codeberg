#define _POSIX_C_SOURCE 200809L

#include "indexer.h"
#include "ipc.h"
#include "wipe.h"

#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static cberg_engine *g_eng;

static void on_signal(int sig) {
    (void)sig;
    if (g_eng != NULL) {
        cberg_engine_request_stop(g_eng);
    }
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--capabilities") == 0) {
#ifdef CBERG_WITH_ONNX
        puts("{\"onnx\":true}");
#else
        puts("{\"onnx\":false}");
#endif
        return 0;
    }

    if (argc == 4 && strcmp(argv[1], "--wipe-index") == 0) {
        return cberg_wipe_index(argv[2], argv[3]);
    }

    if (argc != 1) {
        fprintf(stderr, "usage: cberg-index [--capabilities | --wipe-index BASE ROOT]\n");
        return 1;
    }

    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);

    cberg_engine eng;
    g_eng = &eng;
    cberg_status st = cberg_engine_open(&eng);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index: %s\n", cberg_status_str(st));
        return 1;
    }

    cberg_ipc_server *ipc = NULL;
    if (cberg_ipc_start(&eng, &ipc) != 0) {
        fprintf(stderr, "cberg-index: ipc listen failed on %s\n", eng.socket_path);
        cberg_engine_close(&eng);
        return 1;
    }

    fprintf(stderr, "cberg-index: %zu root(s) vectors=%d socket=%s\n", eng.repos_len, eng.vectors, eng.socket_path);
    if (eng.vectors) {
        const char *backend = getenv("CBERG_EMBED_BACKEND");
        fprintf(stderr, "cberg-index: embedding backend=%s model=%s\n",
                backend != NULL ? backend : "onnx", eng.model_path);
    }
    for (size_t i = 0; i < eng.repos_len; i++) {
        cberg_repo *r = eng.repos[i];
        fprintf(stderr, "cberg-index[%s]: root=%s index=%s\n", r->key, r->root, r->index_path != NULL ? r->index_path : "(none)");
    }

    size_t ok = 0;
    st = cberg_engine_bootstrap(&eng, &ok);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index: bootstrap: no repo could be indexed\n");
        cberg_ipc_stop(ipc);
        cberg_engine_close(&eng);
        return 1;
    }
    if (eng.repos_len > 1) {
        fprintf(stderr, "cberg-index: bootstrap complete: %zu chunks across %zu/%zu repos\n", cberg_engine_chunk_count(&eng), ok, eng.repos_len);
    }

    st = cberg_engine_run(&eng);
    if (st != CBERG_OK && !cberg_engine_stop_requested(&eng)) {
        fprintf(stderr, "cberg-index: %s\n", cberg_status_str(st));
    }

    g_eng = NULL;

    cberg_ipc_stop(ipc);
    cberg_engine_close(&eng);
    return st == CBERG_OK ? 0 : 1;
}
