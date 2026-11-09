#include "codeberg/codeberg.h"

#include "pathutil.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int failures;
static int file_count;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

static int on_file(const char *abs, const char *rel, void *ctx) {
    (void)abs;
    (void)ctx;
    if (strcmp(rel, "src/keep.go") == 0 || strcmp(rel, "keep.txt") == 0 || strcmp(rel, "build") == 0) {
        file_count++;
    } else {
        fprintf(stderr, "FAIL: unexpected walk entry %s\n", rel);
        failures++;
    }
    return 0;
}

static int manifest_count;

static cberg_status on_entry(void *ctx, const char *abs, const char *rel, cberg_fs_entry_kind kind) {
    (void)ctx;
    (void)abs;
    if (kind == CBERG_FS_FILE) {
        manifest_count++;
        CHECK(strcmp(rel, "src/keep.go") == 0 || strcmp(rel, "keep.txt") == 0 || strcmp(rel, "build") == 0,
              "entry walk visits the same files");
    }
    return CBERG_OK;
}

int main(void) {
    char tmpl[] = "/tmp/cberg-walk-XXXXXX";
    char *root = mkdtemp(tmpl);
    CHECK(root != NULL, "mkdtemp");

    char path[512];
    snprintf(path, sizeof(path), "%s/keep.txt", root);
    FILE *f = fopen(path, "w");
    CHECK(f != NULL, "keep.txt");
    fputs("ok\n", f);
    fclose(f);

    snprintf(path, sizeof(path), "%s/.git", root);
    CHECK(mkdir(path, 0755) == 0, "mkdir .git");
    snprintf(path, sizeof(path), "%s/.git/HEAD", root);
    f = fopen(path, "w");
    CHECK(f != NULL, "git HEAD");
    fputs("ref\n", f);
    fclose(f);

    snprintf(path, sizeof(path), "%s/src", root);
    CHECK(mkdir(path, 0755) == 0, "mkdir src");
    snprintf(path, sizeof(path), "%s/src/keep.go", root);
    f = fopen(path, "w");
    CHECK(f != NULL, "keep.go");
    fputs("package main\n", f);
    fclose(f);

    snprintf(path, sizeof(path), "%s/node_modules", root);
    CHECK(mkdir(path, 0755) == 0, "mkdir node_modules");
    snprintf(path, sizeof(path), "%s/node_modules/pkg", root);
    CHECK(mkdir(path, 0755) == 0, "mkdir pkg");
    snprintf(path, sizeof(path), "%s/node_modules/pkg/index.js", root);
    f = fopen(path, "w");
    CHECK(f != NULL, "skipped js");
    fputs("module.exports = {}\n", f);
    fclose(f);

    /* A file named like a skipped directory is still a file. */
    snprintf(path, sizeof(path), "%s/build", root);
    f = fopen(path, "w");
    CHECK(f != NULL, "build script");
    fputs("#!/bin/sh\n", f);
    fclose(f);

    /* Symlinks are not followed: no cycles, nothing outside the root. */
    char link[512];
    snprintf(link, sizeof(link), "%s/loop", root);
    CHECK(symlink(".", link) == 0, "symlink loop");
    snprintf(link, sizeof(link), "%s/alias.txt", root);
    CHECK(symlink("keep.txt", link) == 0, "symlink file");

    CHECK(cberg_fs_walk_files(root, on_file, NULL) == 0, "walk ok");
    CHECK(file_count == 3, "only non-skipped regular files");

    CHECK(cberg_fs_walk(root, "", on_entry, NULL) == CBERG_OK, "entry walk ok");
    CHECK(manifest_count == 3, "entry walk sees the same files");

    snprintf(path, sizeof(path), "%s/missing", root);
    CHECK(cberg_fs_walk_files(path, on_file, NULL) != 0, "a missing root is an error");

    snprintf(link, sizeof(link), "%s/loop", root);
    unlink(link);
    snprintf(link, sizeof(link), "%s/alias.txt", root);
    unlink(link);
    snprintf(path, sizeof(path), "%s/build", root);
    remove(path);

    snprintf(path, sizeof(path), "%s/src/keep.go", root);
    remove(path);
    snprintf(path, sizeof(path), "%s/src", root);
    rmdir(path);
    snprintf(path, sizeof(path), "%s/node_modules/pkg/index.js", root);
    remove(path);
    snprintf(path, sizeof(path), "%s/node_modules/pkg", root);
    rmdir(path);
    snprintf(path, sizeof(path), "%s/node_modules", root);
    rmdir(path);
    snprintf(path, sizeof(path), "%s/.git/HEAD", root);
    remove(path);
    snprintf(path, sizeof(path), "%s/.git", root);
    rmdir(path);
    snprintf(path, sizeof(path), "%s/keep.txt", root);
    remove(path);
    rmdir(root);
    return failures == 0 ? 0 : 1;
}
