#include "indexer.h"

#include "embed_internal.h"

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static double monotonic_seconds(void) {
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (double)now.tv_sec + (double)now.tv_nsec / 1e9;
}

/* Caller owns embed_mu, except during single-threaded engine setup.
 * Lock order is repo->mu before embed_mu; never acquire a repo lock here. */
static cberg_status load_embedder(cberg_engine *eng) {
    if (eng->embedder != NULL) {
        return CBERG_OK;
    }
    cberg_embedder *model = NULL;
    cberg_status st = cberg_embedder_open(&eng->embed_config, &model);
    if (st != CBERG_OK) {
        return st;
    }
    size_t dim = cberg_embedder_dim(model);
    if (eng->embed_dim != 0 && dim != eng->embed_dim) {
        cberg_embedder_close(model);
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    eng->embedder = model;
    eng->embed_dim = dim;
    eng->embed_last_used = monotonic_seconds();
    return CBERG_OK;
}

cberg_status cberg_engine_open_embedder(cberg_engine *eng) {
    eng->embed_idle_seconds = 300;
    const char *idle = getenv("CBERG_EMBED_IDLE_SECONDS");
    if (idle != NULL && idle[0] != '\0') {
        char *end = NULL;
        errno = 0;
        long seconds = strtol(idle, &end, 10);
        if (errno != 0 || *end != '\0' || seconds < 0 || seconds > 86400) {
            return CBERG_ERR_INVALID_ARGUMENT;
        }
        eng->embed_idle_seconds = (unsigned)seconds;
    }

    const char *backend = getenv("CBERG_EMBED_BACKEND");
    eng->embed_config.provider = backend != NULL &&
        (strcmp(backend, "mlx") == 0 || strcmp(backend, "llama") == 0 ||
         strcmp(backend, "sentence-transformers") == 0 || strcmp(backend, "gemma-mlx") == 0)
        ? CBERG_EMBED_WORKER : CBERG_EMBED_ONNX;
    eng->embed_config.model_path = eng->model_path;
    const char *threads = getenv("CBERG_EMBED_THREADS");
    eng->embed_config.num_threads = threads != NULL ? atoi(threads) : 0;
    return load_embedder(eng);
}

cberg_status cberg_engine_embed(cberg_engine *eng, const char *const *texts, const size_t *lens,
                               size_t count, int query, float **out_vectors) {
    pthread_mutex_lock(&eng->embed_mu);
    cberg_status st = load_embedder(eng);
    if (st == CBERG_OK) {
        st = query ? cberg_embedder_embed_query(eng->embedder, texts, lens, count, out_vectors)
                   : cberg_embedder_embed(eng->embedder, texts, lens, count, out_vectors);
    }
    eng->embed_last_used = monotonic_seconds();
    pthread_mutex_unlock(&eng->embed_mu);
    return st;
}

void cberg_engine_trim_embedder(cberg_engine *eng) {
    if (!eng->vectors || eng->embed_idle_seconds == 0 || pthread_mutex_trylock(&eng->embed_mu) != 0) {
        return;
    }
    if (eng->embedder != NULL && monotonic_seconds() - eng->embed_last_used >= eng->embed_idle_seconds) {
        cberg_embedder_close(eng->embedder);
        eng->embedder = NULL;
    }
    pthread_mutex_unlock(&eng->embed_mu);
}
