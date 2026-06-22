#include "codeberg/codeberg.h"

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

int main(void) {
    cberg_watcher *bad = NULL;
    CHECK(cberg_watcher_open("/tmp/cberg-nonexistent-root-xyz", &bad) == CBERG_ERR_IO, "bad root rejected");
    CHECK(bad == NULL, "bad root leaves null watcher");

    char tmpl[] = "/tmp/cberg-watch-XXXXXX";
    char *dir = mkdtemp(tmpl);
    CHECK(dir != NULL, "mkdtemp");

    char path[512];
    snprintf(path, sizeof(path), "%s/sample.go", dir);
    FILE *f = fopen(path, "w");
    CHECK(f != NULL, "create file");
    fputs("package main\nfunc A() {}\n", f);
    fclose(f);

    cberg_watcher *w = NULL;
    CHECK(cberg_watcher_open(dir, &w) == CBERG_OK, "watch open");

    f = fopen(path, "a");
    CHECK(f != NULL, "append open");
    fputs("func B() {}\n", f);
    fclose(f);

    cberg_watch_event events[8];
    size_t n = 0;
    for (int i = 0; i < 100 && n == 0; i++) {
        CHECK(cberg_watcher_poll(w, events, 8, &n, 200) == CBERG_OK, "poll");
    }
    CHECK(n > 0, "saw change");
    CHECK(events[0].kind == CBERG_WATCH_MODIFY || events[0].kind == CBERG_WATCH_CREATE, "modify or create kind");

    for (size_t i = 0; i < n; i++) {
        free((void *)events[i].path);
    }

    size_t after_poll = 99;
    CHECK(cberg_watcher_dirty_paths(w, NULL, 0, &after_poll) == CBERG_OK, "dirty_paths after poll");
    CHECK(after_poll == 0, "dirty_paths empty after poll drained set");

    cberg_watcher_close(w);
    remove(path);
    rmdir(dir);
    return failures == 0 ? 0 : 1;
}
