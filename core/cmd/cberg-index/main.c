#define _POSIX_C_SOURCE 200809L

#include "indexer.h"
#include "ipc.h"

#include <signal.h>
#include <stdio.h>
#include <stdlib.h>

static volatile sig_atomic_t g_stop;
static cberg_engine *g_eng;

static void on_signal(int sig) {
    (void)sig;
    g_stop = 1;
    if (g_eng != NULL) {
        g_eng->stop = 1;
    }
}

int main(void) {
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
    for (size_t i = 0; i < eng.repos_len; i++) {
        cberg_repo *r = eng.repos[i];
        fprintf(stderr, "cberg-index[%s]: root=%s index=%s\n", r->key, r->root,
                r->index_path != NULL ? r->index_path : "(none)");
    }

    /* Bootstrap repos sequentially — the shared embedder is the throughput
     * bottleneck, so parallel bootstraps would just contend on embed_mu. A repo
     * that fails stays not-ready (searches skip it, status reports it) rather
     * than taking down its siblings; only losing every repo is fatal. */
    size_t ok = 0;
    for (size_t i = 0; i < eng.repos_len && !eng.stop; i++) {
        cberg_repo *r = eng.repos[i];
        st = cberg_repo_bootstrap(r);
        if (st != CBERG_OK) {
            fprintf(stderr, "cberg-index[%s]: bootstrap: %s\n", r->key, cberg_status_str(st));
            continue;
        }
        ok++;
        fprintf(stderr, "cberg-index[%s]: bootstrap complete: %zu chunks indexed\n", r->key,
                cberg_repo_chunk_count(r));
    }
    if (ok == 0 && !eng.stop) {
        fprintf(stderr, "cberg-index: bootstrap: no repo could be indexed\n");
        cberg_ipc_stop(ipc);
        cberg_engine_close(&eng);
        return 1;
    }
    eng.bootstrapped = 1;
    if (eng.repos_len > 1) {
        fprintf(stderr, "cberg-index: bootstrap complete: %zu chunks across %zu/%zu repos\n",
                cberg_engine_chunk_count(&eng), ok, eng.repos_len);
    }

    st = cberg_engine_run(&eng);
    if (st != CBERG_OK && !eng.stop) {
        fprintf(stderr, "cberg-index: %s\n", cberg_status_str(st));
    }

    g_eng = NULL;

    cberg_ipc_stop(ipc);
    cberg_engine_close(&eng);
    return st == CBERG_OK ? 0 : 1;
}
