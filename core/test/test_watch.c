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

    f = fopen(path, "a");
    CHECK(f != NULL, "append for discard drain");
    fputs("// touch\n", f);
    fclose(f);

    size_t discarded = 0;
    for (int i = 0; i < 100 && discarded == 0; i++) {
        cberg_status st = cberg_watcher_poll(w, NULL, 0, &discarded, 200);
        CHECK(st == CBERG_OK, "poll discard drain");
    }
    CHECK(discarded > 0, "discard drain counted pending paths");

    for (int i = 0; i < 12; i++) {
        char extra[512];
        snprintf(extra, sizeof(extra), "%s/extra%d.go", dir, i);
        f = fopen(extra, "w");
        CHECK(f != NULL, "create extra file");
        fputs("package main\n", f);
        fclose(f);
    }

    cberg_watch_event small[2];
    size_t got = 0;
    cberg_status overflow_st = CBERG_ERR_INTERNAL;
    for (int i = 0; i < 150; i++) {
        overflow_st = cberg_watcher_poll(w, small, 2, &got, 300);
        if (overflow_st == CBERG_ERR_INVALID_ARGUMENT || got > 0) {
            break;
        }
        got = 0;
    }
    CHECK(overflow_st == CBERG_ERR_INVALID_ARGUMENT, "overflow returns INVALID_ARGUMENT");
    CHECK(got == 0, "overflow transfers nothing");

    got = 99;
    CHECK(cberg_watcher_poll(w, small, 2, &got, 300) == CBERG_ERR_INVALID_ARGUMENT, "overflow still pending");
    CHECK(got == 0, "small cap still transfers nothing");

    cberg_watch_event all[16];
    size_t all_got = 0;
    for (int i = 0; i < 150 && all_got == 0; i++) {
        CHECK(cberg_watcher_poll(w, all, 16, &all_got, 300) == CBERG_OK, "drain all after overflow");
    }
    CHECK(all_got > 2, "transferred all pending after retry");
    for (size_t i = 0; i < all_got; i++) {
        free((void *)all[i].path);
    }

    cberg_watcher_close(w);
    remove(path);
    for (int i = 0; i < 12; i++) {
        char extra[512];
        snprintf(extra, sizeof(extra), "%s/extra%d.go", dir, i);
        remove(extra);
    }
    rmdir(dir);
    return failures == 0 ? 0 : 1;
}
