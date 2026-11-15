/* A cold bootstrap must survive the odd file or folder it cannot read: one
 * permission error used to abort the whole index, and the supervisor then
 * restarted the indexer into the same failure indefinitely. */
#include "indexer.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

static const char *go_src = "package main\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n";

static void join(char *out, size_t cap, const char *root, const char *rel) {
    snprintf(out, cap, "%s/%s", root, rel);
}

static void write_file(const char *root, const char *rel, const char *body) {
    char path[512];
    join(path, sizeof(path), root, rel);

    FILE *f = fopen(path, "w");
    CHECK(f != NULL, "write fixture");
    if (f == NULL) {
        return;
    }

    fputs(body, f);
    fclose(f);
}

static void set_mode(const char *root, const char *rel, mode_t mode) {
    char path[512];
    join(path, sizeof(path), root, rel);
    CHECK(chmod(path, mode) == 0, "chmod fixture");
}

static void remove_path(const char *root, const char *rel) {
    char path[512];
    join(path, sizeof(path), root, rel);
    remove(path);
}

int main(void) {
    char tmpl[] = "/tmp/cberg-bootstrap-XXXXXX";
    char *root = mkdtemp(tmpl);
    CHECK(root != NULL, "mkdtemp");
    if (root == NULL) {
        return 1;
    }

    char private_dir[512];
    join(private_dir, sizeof(private_dir), root, "private");
    CHECK(mkdir(private_dir, 0755) == 0, "mkdir private");

    write_file(root, "good.go", go_src);
    write_file(root, "locked.go", go_src);
    write_file(root, "blob.bin", "not source");
    write_file(root, "private/hidden.go", go_src);

    /* Oversized sources (generated parsers, bundles, data dumps) are left out. */
    char big[8192];
    size_t off = (size_t)snprintf(big, sizeof(big), "package main\n");
    for (int i = 0; i < 100; i++) {
        off += (size_t)snprintf(big + off, sizeof(big) - off, "func Generated%d() int {\n\treturn %d\n}\n", i, i);
    }
    write_file(root, "generated.go", big);
    setenv("CBERG_MAX_FILE_BYTES", "2048", 1);

    set_mode(root, "locked.go", 0000);
    set_mode(root, "blob.bin", 0000);
    set_mode(root, "private", 0000);

    char socket_path[256];
    snprintf(socket_path, sizeof(socket_path), "/tmp/cberg-bootstrap-test-%d.sock", (int)getpid());

    unsetenv("CBERG_MODEL");
    unsetenv("CBERG_INDEX_PATH");
    unsetenv("CODEBERG_ROOT");
    setenv("CBERG_SOCKET", socket_path, 1);

    char roots[1024];
    snprintf(roots, sizeof(roots), "solo\t%s\n", root);
    setenv("CODEBERG_ROOTS", roots, 1);

    cberg_engine eng;
    cberg_status st = cberg_engine_open(&eng);
    CHECK(st == CBERG_OK && eng.repos_len == 1, "engine opens");

    if (st == CBERG_OK && eng.repos_len == 1) {
        cberg_repo *r = eng.repos[0];

        /* Root can read anything, so the fixtures only bite for normal users. */
        CHECK(cberg_repo_bootstrap(r) == CBERG_OK, "bootstrap skips unreadable paths");
        CHECK(cberg_repo_ready(r), "repo is ready despite unreadable paths");
        CHECK(cberg_repo_chunk_count(r) >= 1, "readable files are still indexed");
        CHECK(cberg_repo_chunk_count(r) < 50, "files over the size limit are not indexed");
    }

    if (st == CBERG_OK) {
        cberg_engine_close(&eng);
    }

    set_mode(root, "private", 0755);
    remove_path(root, "private/hidden.go");
    remove_path(root, "private");
    remove_path(root, "locked.go");
    remove_path(root, "blob.bin");
    remove_path(root, "good.go");
    remove_path(root, "generated.go");
    rmdir(root);
    unlink(socket_path);

    if (failures == 0) {
        printf("ok - bootstrap\n");
        return 0;
    }
    return 1;
}
