/* Nested roots: a parent root leaves out directories indexed as their own roots. */
#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "test_common.h"

static void write_file(const char *root, const char *rel, const char *content) {
    char path[1024];
    snprintf(path, sizeof(path), "%s/%s", root, rel);

    for (char *p = path + strlen(root) + 1; *p != '\0'; p++) {
        if (*p == '/') {
            *p = '\0';
            mkdir(path, 0777);
            *p = '/';
        }
    }

    FILE *f = fopen(path, "w");
    if (f != NULL) {
        fputs(content, f);
        fclose(f);
    }
}

static int manifest_has(const cberg_manifest *m, const char *rel) {
    for (size_t i = 0; i < cberg_manifest_len(m); i++) {
        if (strcmp(cberg_manifest_at(m, i)->path, rel) == 0) {
            return 1;
        }
    }

    return 0;
}

static void make_team(const char *root) {
    write_file(root, "README.md", "team docs\n");
    write_file(root, "api/main.go", "package main\n");
    write_file(root, "apiary/hive.go", "package hive\n");
    write_file(root, "services/billing/bill.go", "package billing\n");
    write_file(root, "services/shared.go", "package services\n");
}

static void test_manifest_leaves_out_nested_roots(const char *root) {
    const char *dirs[] = {"api", "services/billing"};
    cberg_exclusions ex = {.dirs = dirs, .len = 2};

    cberg_manifest *m = NULL;
    CHECK(cberg_manifest_rebuild_ex(NULL, root, &ex, &m) == CBERG_OK, "manifest with exclusions");

    CHECK(manifest_has(m, "README.md"), "keeps files outside nested roots");
    CHECK(manifest_has(m, "services/shared.go"), "keeps siblings of a nested root");
    CHECK(manifest_has(m, "apiary/hive.go"), "a shared name prefix is not a nested root");
    CHECK(!manifest_has(m, "api/main.go"), "leaves out a nested root");
    CHECK(!manifest_has(m, "services/billing/bill.go"), "leaves out a deeper nested root");

    cberg_manifest_free(m);

    CHECK(cberg_manifest_rebuild_ex(NULL, root, NULL, &m) == CBERG_OK, "manifest without exclusions");
    CHECK(manifest_has(m, "api/main.go"), "no exclusions keeps every file");
    cberg_manifest_free(m);
}

static int drain_has(cberg_watcher *w, const char *rel) {
    cberg_watch_event events[32];
    size_t n = 0;
    int found = 0;

    for (int i = 0; i < 20; i++) {
        CHECK(cberg_watcher_poll(w, events, 32, &n, 100) == CBERG_OK, "poll");

        for (size_t j = 0; j < n; j++) {
            found |= strcmp(events[j].path, rel) == 0;
            free((void *)events[j].path);
        }
    }

    return found;
}

static void test_watcher_ignores_nested_roots(const char *root) {
    const char *dirs[] = {"api"};
    cberg_exclusions ex = {.dirs = dirs, .len = 1};

    cberg_watcher *w = NULL;
    CHECK(cberg_watcher_open_ex(root, &ex, &w) == CBERG_OK, "watcher with exclusions");

    write_file(root, "api/new.go", "package main\n");
    write_file(root, "notes.md", "note\n");

    CHECK(drain_has(w, "notes.md"), "reports changes outside nested roots");

    write_file(root, "api/later.go", "package main\n");
    CHECK(!drain_has(w, "api/later.go"), "ignores changes inside a nested root");

    cberg_watcher_close(w);
}

int main(void) {
    char tmpl[] = "/tmp/cberg-exclusions-XXXXXX";
    char *root = mkdtemp(tmpl);
    CHECK(root != NULL, "mkdtemp");

    make_team(root);
    test_manifest_leaves_out_nested_roots(root);
    test_watcher_ignores_nested_roots(root);

    char cmd[1100];
    snprintf(cmd, sizeof(cmd), "rm -rf '%s'", root);
    CHECK(system(cmd) == 0, "cleanup");

    if (failures == 0) {
        printf("ok - exclusions\n");
    }
    TEST_MAIN_RETURN
}
