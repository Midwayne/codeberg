#define _POSIX_C_SOURCE 200809L

#include "indexer.h"
#include "ipc.h"

#include <signal.h>
#include <stdio.h>
#include <stdlib.h>

static volatile sig_atomic_t g_stop;
static cberg_indexer *g_idx;

static void on_signal(int sig) {
    (void)sig;
    g_stop = 1;
    if (g_idx != NULL) {
        g_idx->stop = 1;
    }
}

int main(void) {
    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);

    cberg_indexer idx;
    g_idx = &idx;
    cberg_status st = cberg_indexer_open(&idx);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index: %s\n", cberg_status_str(st));
        return 1;
    }

    cberg_ipc_server *ipc = NULL;
    if (cberg_ipc_start(&idx, &ipc) != 0) {
        fprintf(stderr, "cberg-index: ipc listen failed on %s\n", idx.socket_path);
        cberg_indexer_close(&idx);
        return 1;
    }

    fprintf(stderr, "cberg-index: root=%s vectors=%d socket=%s\n", idx.root, idx.vectors, idx.socket_path);

    st = cberg_indexer_bootstrap(&idx);
    if (st != CBERG_OK) {
        fprintf(stderr, "cberg-index: bootstrap: %s\n", cberg_status_str(st));
        cberg_ipc_stop(ipc);
        cberg_indexer_close(&idx);
        return 1;
    }
    fprintf(stderr, "cberg-index: bootstrap complete\n");

    st = cberg_indexer_run(&idx);
    if (st != CBERG_OK && !idx.stop) {
        fprintf(stderr, "cberg-index: %s\n", cberg_status_str(st));
    }

    g_idx = NULL;

    cberg_ipc_stop(ipc);
    cberg_indexer_close(&idx);
    return st == CBERG_OK ? 0 : 1;
}
