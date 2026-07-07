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
    if (strcmp(rel, "src/keep.go") == 0 || strcmp(rel, "keep.txt") == 0) {
        file_count++;
    }
    return 0;
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

    CHECK(cberg_fs_walk_files(root, on_file, NULL) == 0, "walk ok");
    CHECK(file_count == 2, "only non-skipped files");

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
