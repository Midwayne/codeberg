/*
 * Watcher event semantics: create / update / delete, plus batch and concurrent
 * deletions. The delete cases are the regression guard for the macOS bug where
 * removed files were dropped (realpath() fails on a path that no longer exists),
 * so their chunks were never purged. Driven through the public watcher API, so
 * it exercises whichever backend the platform uses (FSEvents / inotify / poll).
 */
#include "codeberg/codeberg.h"

#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

static void write_file(const char *dir, const char *name, const char *content) {
    char p[1024];
    snprintf(p, sizeof(p), "%s/%s", dir, name);
    FILE *f = fopen(p, "w");
    if (f != NULL) {
        fputs(content, f);
        fclose(f);
    }
}

static void rm_file(const char *dir, const char *name) {
    char p[1024];
    snprintf(p, sizeof(p), "%s/%s", dir, name);
    remove(p);
}

typedef struct {
    char *path;
    cberg_watch_kind kind;
} ev;

/* Discard any pending events so a scenario starts from a clean slate. */
static void drain(cberg_watcher *w) {
    int empties = 0;
    for (int i = 0; i < 40 && empties < 2; i++) {
        size_t got = 0;
        if (cberg_watcher_poll(w, NULL, 0, &got, 100) != CBERG_OK) {
            return;
        }
        empties = (got == 0) ? empties + 1 : 0;
    }
}

/*
 * Poll until the event stream goes quiet, aggregating by path (latest kind
 * wins, as the watcher coalesces). Returns the distinct-path count; *err holds
 * the first hard poll error, if any. Caller frees each out[i].path.
 */
static size_t collect(cberg_watcher *w, ev *out, size_t cap, cberg_status *err) {
    *err = CBERG_OK;
    size_t n = 0;
    int empties = 0;
    for (int t = 0; t < 80 && empties < 3; t++) {
        cberg_watch_event buf[512];
        size_t got = 0;
        cberg_status st = cberg_watcher_poll(w, buf, 512, &got, 100);
        if (st != CBERG_OK && st != CBERG_ERR_TIMEOUT) {
            *err = st;
            return n;
        }
        if (got == 0) {
            empties++;
            continue;
        }
        empties = 0;
        for (size_t i = 0; i < got; i++) {
            size_t j = 0;
            for (; j < n; j++) {
                if (strcmp(out[j].path, buf[i].path) == 0) {
                    break;
                }
            }
            if (j < n) {
                out[j].kind = buf[i].kind;
                free((void *)buf[i].path);
            } else if (n < cap) {
                out[n].path = (char *)buf[i].path;
                out[n].kind = buf[i].kind;
                n++;
            } else {
                free((void *)buf[i].path);
            }
        }
    }
    return n;
}

static void free_events(ev *e, size_t n) {
    for (size_t i = 0; i < n; i++) {
        free(e[i].path);
    }
}

static int find_kind(ev *e, size_t n, const char *path, cberg_watch_kind *out) {
    for (size_t i = 0; i < n; i++) {
        if (strcmp(e[i].path, path) == 0) {
            if (out != NULL) {
                *out = e[i].kind;
            }
            return 1;
        }
    }
    return 0;
}

typedef struct {
    const char *dir;
    int start;
    int count;
} del_job;

static void *del_worker(void *arg) {
    del_job *j = arg;
    for (int i = 0; i < j->count; i++) {
        char name[64];
        snprintf(name, sizeof(name), "race%d.go", j->start + i);
        rm_file(j->dir, name);
    }
    return NULL;
}

int main(void) {
    char tmpl[] = "/tmp/cberg-watchev-XXXXXX";
    char *dir = mkdtemp(tmpl);
    CHECK(dir != NULL, "mkdtemp");
    if (dir == NULL) {
        return 1;
    }
    write_file(dir, "seed.go", "package main\nfunc S(){}\n");

    cberg_watcher *w = NULL;
    CHECK(cberg_watcher_open(dir, &w) == CBERG_OK, "open watcher");
    if (w == NULL) {
        return 1;
    }

    ev got[700];
    size_t n;
    cberg_status err;
    cberg_watch_kind k;

    /* --- CREATE: a new file surfaces, not as a delete --- */
    drain(w);
    write_file(dir, "created.go", "package main\nfunc C(){}\n");
    n = collect(w, got, 700, &err);
    CHECK(err == CBERG_OK, "create: no poll error");
    CHECK(find_kind(got, n, "created.go", &k), "create: new file reported");
    CHECK(k != CBERG_WATCH_DELETE, "create: not a delete");
    free_events(got, n);

    /* --- UPDATE: modifying an existing file reports it, not as a delete --- */
    drain(w);
    write_file(dir, "seed.go", "package main\nfunc S(){}\nfunc S2(){}\n");
    n = collect(w, got, 700, &err);
    CHECK(err == CBERG_OK, "modify: no poll error");
    CHECK(find_kind(got, n, "seed.go", &k), "modify: change reported");
    CHECK(k != CBERG_WATCH_DELETE, "modify: not a delete");
    free_events(got, n);

    /* --- DELETE: the regression. A removed file MUST report DELETE --- */
    drain(w);
    rm_file(dir, "seed.go");
    n = collect(w, got, 700, &err);
    CHECK(err == CBERG_OK, "delete: no poll error");
    CHECK(find_kind(got, n, "seed.go", &k), "delete: removed file reported");
    CHECK(k == CBERG_WATCH_DELETE, "delete: reported as DELETE (regression guard)");
    free_events(got, n);

    /* --- BATCH DELETE: many files removed at once are all reported DELETE --- */
    enum { NDEL = 24 };
    drain(w);
    for (int i = 0; i < NDEL; i++) {
        char nm[64];
        snprintf(nm, sizeof(nm), "batch%d.go", i);
        write_file(dir, nm, "package main\n");
    }
    drain(w); /* absorb the creates */
    for (int i = 0; i < NDEL; i++) {
        char nm[64];
        snprintf(nm, sizeof(nm), "batch%d.go", i);
        rm_file(dir, nm);
    }
    n = collect(w, got, 700, &err);
    CHECK(err == CBERG_OK, "batch-delete: no poll error");
    int batch_deleted = 0;
    for (int i = 0; i < NDEL; i++) {
        char nm[64];
        snprintf(nm, sizeof(nm), "batch%d.go", i);
        if (find_kind(got, n, nm, &k) && k == CBERG_WATCH_DELETE) {
            batch_deleted++;
        }
    }
    CHECK(batch_deleted == NDEL, "batch-delete: every removal reported as DELETE");
    free_events(got, n);

    /* --- MIXED: create + modify + delete in one window, each its own kind --- */
    drain(w);
    write_file(dir, "keep.go", "package main\nfunc K(){}\n");
    write_file(dir, "doomed.go", "package main\nfunc D(){}\n");
    drain(w);
    write_file(dir, "fresh.go", "package main\nfunc F(){}\n");                /* create */
    write_file(dir, "keep.go", "package main\nfunc K(){}\nfunc K2(){}\n");    /* modify */
    rm_file(dir, "doomed.go");                                               /* delete */
    n = collect(w, got, 700, &err);
    CHECK(err == CBERG_OK, "mixed: no poll error");
    CHECK(find_kind(got, n, "fresh.go", &k) && k != CBERG_WATCH_DELETE, "mixed: create not delete");
    CHECK(find_kind(got, n, "keep.go", &k) && k != CBERG_WATCH_DELETE, "mixed: modify not delete");
    CHECK(find_kind(got, n, "doomed.go", &k) && k == CBERG_WATCH_DELETE, "mixed: delete is DELETE");
    free_events(got, n);

    /* --- RACING: concurrent deletions from multiple threads, none lost --- */
    enum { NRACE = 40, NTHREADS = 4 };
    drain(w);
    for (int i = 0; i < NRACE; i++) {
        char nm[64];
        snprintf(nm, sizeof(nm), "race%d.go", i);
        write_file(dir, nm, "package main\n");
    }
    drain(w); /* absorb the creates */
    pthread_t th[NTHREADS];
    del_job jobs[NTHREADS];
    for (int t = 0; t < NTHREADS; t++) {
        jobs[t] = (del_job){.dir = dir, .start = t * (NRACE / NTHREADS), .count = NRACE / NTHREADS};
        CHECK(pthread_create(&th[t], NULL, del_worker, &jobs[t]) == 0, "racing: spawn deleter");
    }
    for (int t = 0; t < NTHREADS; t++) {
        pthread_join(th[t], NULL);
    }
    n = collect(w, got, 700, &err);
    CHECK(err == CBERG_OK, "racing: no poll error under concurrent deletes");
    int race_deleted = 0;
    for (int i = 0; i < NRACE; i++) {
        char nm[64];
        snprintf(nm, sizeof(nm), "race%d.go", i);
        if (find_kind(got, n, nm, &k) && k == CBERG_WATCH_DELETE) {
            race_deleted++;
        }
    }
    CHECK(race_deleted == NRACE, "racing: all concurrent deletions captured as DELETE");
    free_events(got, n);

    cberg_watcher_close(w);

    char cmd[1100];
    snprintf(cmd, sizeof(cmd), "rm -rf '%s'", dir);
    if (system(cmd) != 0) {
        fprintf(stderr, "warning: cleanup failed\n");
    }

    if (failures == 0) {
        printf("test_watch_events: ok\n");
    }
    return failures == 0 ? 0 : 1;
}
