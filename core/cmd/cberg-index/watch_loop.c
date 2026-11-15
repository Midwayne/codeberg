#define _POSIX_C_SOURCE 200809L

#include "indexer_internal.h"

#include "chunk_table_internal.h"

#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef __GLIBC__
#include <malloc.h>
#endif

/* Drain one repo's watcher (non-blocking) and apply any changes. */
static cberg_status repo_step(cberg_repo *r, size_t *out_events) {
    *out_events = 0;

    cberg_watch_event events[256];
    size_t count = 0;
    cberg_status st = cberg_watcher_poll(r->watcher, events, 256, &count, 0);
    if (st == CBERG_ERR_TIMEOUT) {
        return CBERG_OK;
    }
    if (st != CBERG_OK) {
        return st;
    }
    if (count == 0) {
        return CBERG_OK;
    }

    char **rechunk = calloc(count, sizeof(*rechunk));
    char **deleted = calloc(count, sizeof(*deleted));
    size_t rechunk_n = 0;
    size_t deleted_n = 0;
    if (rechunk == NULL || deleted == NULL) {
        free(rechunk);
        free(deleted);
        for (size_t i = 0; i < count; i++) {
            free((void *)events[i].path);
        }
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    for (size_t i = 0; i < count; i++) {
        if (events[i].kind == CBERG_WATCH_DELETE) {
            deleted[deleted_n++] = strdup(events[i].path);
        } else {
            rechunk[rechunk_n++] = strdup(events[i].path);
        }
        free((void *)events[i].path);
    }

    pthread_mutex_lock(&r->eng->work_mu);
    atomic_store(&r->eng->updating, 1);
    pthread_mutex_lock(&r->mu);
    atomic_store(&r->progress_active, 1);
    repo_progress_begin(r, "counting", 0, 0);
    st = repo_apply_path_changes(r, rechunk, rechunk_n, deleted, deleted_n);
    if (st == CBERG_OK) {
        /* Persist chunk table + graph every sync so a restart never re-embeds
         * or loses structural work done this session. Manifest baseline is
         * refreshed on close. Re-resolve imports so new relative/module paths
         * become FILE edges without waiting for a cold restart. */
        repo_resolve_imports(r);
        repo_save_chunk_table(r);
        repo_save_graph(r);
    }
    repo_publish_status(r);
    atomic_store(&r->progress_active, 0);
    pthread_mutex_unlock(&r->mu);

    atomic_store(&r->eng->updating, 0);
    pthread_mutex_unlock(&r->eng->work_mu);

    for (size_t i = 0; i < rechunk_n; i++) {
        free(rechunk[i]);
    }
    for (size_t i = 0; i < deleted_n; i++) {
        free(deleted[i]);
    }
    free(rechunk);
    free(deleted);

    if (st == CBERG_OK) {
        *out_events = count;
    }
    return st;
}

cberg_status cberg_engine_step(cberg_engine *eng, size_t *out_events) {
    size_t total = 0;
    for (size_t i = 0; i < eng->repos_len; i++) {
        if (eng->stop) {
            break;
        }
        size_t n = 0;
        cberg_status st = repo_step(eng->repos[i], &n);
        if (st != CBERG_OK) {
            return st;
        }
        total += n;
    }
    cberg_engine_trim_embedder(eng);
    if (out_events != NULL) {
        *out_events = total;
    }
    return CBERG_OK;
}

/* Runs only when the watch loop goes idle, so none of it lands on bootstrap or
 * sync latency. The last sync's change lists are dead once its vectors are
 * applied, but after a cold sync they hold one row per chunk until the next
 * sync. glibc keeps freed heap pages mapped, so one transient spike (parsing a
 * huge generated file, a cold bootstrap's batch) would otherwise pin RSS at
 * its high-water mark for the life of the process. */
static void release_free_memory(cberg_engine *eng) {
    for (size_t i = 0; i < eng->repos_len; i++) {
        cberg_repo *r = eng->repos[i];

        pthread_mutex_lock(&r->mu);
        cberg_chunk_table_release_changes(r->table);
        pthread_mutex_unlock(&r->mu);
    }

#ifdef __GLIBC__
    malloc_trim(0);
#endif
}

cberg_status cberg_engine_run(cberg_engine *eng) {
    /* Start dirty: bootstrap ran just before the loop. */
    int dirty = 1;

    for (;;) {
        if (eng->stop) {
            return CBERG_OK;
        }
        size_t handled = 0;
        cberg_status st = cberg_engine_step(eng, &handled);
        if (st != CBERG_OK) {
            return st;
        }
        if (handled != 0) {
            dirty = 1;
        }
        if (handled == 0) {
            /* Trim once per busy->idle transition, off every request path. */
            if (dirty) {
                release_free_memory(eng);
                dirty = 0;
            }

            /* Idle: every watcher was drained non-blocking, so pace the loop.
             * A signal interrupts the sleep and the stop check runs first. */
            struct timespec ts = {.tv_sec = eng->poll_ms / 1000, .tv_nsec = (long)(eng->poll_ms % 1000) * 1000000L};
            nanosleep(&ts, NULL);
        }
    }
}
