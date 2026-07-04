/* Exercises the multi-root engine in chunk-only mode (no embedding model):
 * CODEBERG_ROOTS parsing with dead-entry skipping, independent per-repo
 * bootstrap and watch handling, the CODEBERG_ROOT single-root fallback, and
 * the IPC wire shape (per-repo status, repo-scoped search parsing). */
#include "indexer.h"
#include "ipc.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

static void write_file(const char *root, const char *rel, const char *body) {
    char path[512];
    snprintf(path, sizeof(path), "%s/%s", root, rel);
    FILE *f = fopen(path, "w");
    if (f == NULL) {
        fprintf(stderr, "FAIL: cannot write %s\n", path);
        failures++;
        return;
    }
    fputs(body, f);
    fclose(f);
}

static const char *go_src = "package main\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n";
static const char *go_src2 = "package main\n\nfunc Mul(a, b int) int {\n\treturn a * b\n}\n";

static cberg_repo *repo_by_key(cberg_engine *eng, const char *key) {
    for (size_t i = 0; i < eng->repos_len; i++) {
        if (strcmp(eng->repos[i]->key, key) == 0) {
            return eng->repos[i];
        }
    }
    return NULL;
}

/* Step the engine until repo's chunk count reaches want (watcher delivery is
 * asynchronous on macOS), giving up after ~10s. */
static void step_until_count(cberg_engine *eng, cberg_repo *r, size_t want) {
    for (int i = 0; i < 200; i++) {
        size_t handled = 0;
        if (cberg_engine_step(eng, &handled) != CBERG_OK) {
            break;
        }
        if (cberg_repo_chunk_count(r) >= want) {
            return;
        }
        struct timespec ts = {.tv_sec = 0, .tv_nsec = 50 * 1000000L};
        nanosleep(&ts, NULL);
    }
}

static int ipc_roundtrip(const char *socket_path, const char *req, char *resp, size_t cap) {
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
        return -1;
    }
    struct timeval tv = {.tv_sec = 5, .tv_usec = 0};
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    struct sockaddr_un addr;
    memset(&addr, 0, sizeof(addr));
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, socket_path, sizeof(addr.sun_path) - 1);
    if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
        close(fd);
        return -1;
    }
    if (write(fd, req, strlen(req)) < 0) {
        close(fd);
        return -1;
    }
    ssize_t n = read(fd, resp, cap - 1);
    close(fd);
    if (n <= 0) {
        return -1;
    }
    resp[n] = '\0';
    return 0;
}

int main(void) {
    char tmpl_a[] = "/tmp/cberg-engine-a-XXXXXX";
    char tmpl_b[] = "/tmp/cberg-engine-b-XXXXXX";
    char *root_a = mkdtemp(tmpl_a);
    char *root_b = mkdtemp(tmpl_b);
    CHECK(root_a != NULL && root_b != NULL, "mkdtemp");
    if (root_a == NULL || root_b == NULL) {
        return 1;
    }
    write_file(root_a, "a.go", go_src);
    write_file(root_b, "b.go", go_src);
    write_file(root_b, "b2.go", go_src2);

    char socket_path[256];
    snprintf(socket_path, sizeof(socket_path), "/tmp/cberg-engine-test-%d.sock", (int)getpid());

    /* Chunk-only mode: no model, no index path. */
    unsetenv("CBERG_MODEL");
    unsetenv("CBERG_INDEX_PATH");
    unsetenv("CODEBERG_ROOT");
    setenv("CBERG_SOCKET", socket_path, 1);
    setenv("CBERG_POLL_MS", "50", 1);

    char roots[2048];
    snprintf(roots, sizeof(roots), "alpha\t%s\nbeta\t%s\ndead\t/cberg/definitely/missing\nmalformed-no-tab\n",
             root_a, root_b);
    setenv("CODEBERG_ROOTS", roots, 1);

    cberg_engine eng;
    cberg_status st = cberg_engine_open(&eng);
    CHECK(st == CBERG_OK, "engine opens from CODEBERG_ROOTS");
    if (st != CBERG_OK) {
        return 1;
    }
    CHECK(eng.repos_len == 2, "dead and malformed roots skipped");
    cberg_repo *ra = repo_by_key(&eng, "alpha");
    cberg_repo *rb = repo_by_key(&eng, "beta");
    CHECK(ra != NULL && rb != NULL, "both repos present by key");
    CHECK(!eng.vectors, "chunk-only mode");

    if (ra != NULL && rb != NULL) {
        CHECK(cberg_repo_bootstrap(ra) == CBERG_OK, "alpha bootstraps");
        CHECK(cberg_repo_bootstrap(rb) == CBERG_OK, "beta bootstraps");
        eng.bootstrapped = 1;
        CHECK(cberg_repo_ready(ra) && cberg_repo_ready(rb), "both ready");

        size_t count_a = cberg_repo_chunk_count(ra);
        size_t count_b = cberg_repo_chunk_count(rb);
        CHECK(count_a >= 1, "alpha has chunks");
        CHECK(count_b > count_a, "beta indexed more files than alpha");
        CHECK(cberg_engine_chunk_count(&eng) == count_a + count_b, "engine total sums repos");

        /* A change in alpha must reach alpha's table only. */
        write_file(root_a, "a2.go", go_src2);
        step_until_count(&eng, ra, count_a + 1);
        CHECK(cberg_repo_chunk_count(ra) > count_a, "alpha picked up the new file");
        CHECK(cberg_repo_chunk_count(rb) == count_b, "beta unchanged");

        /* IPC: per-repo status and the 4-field search form. */
        cberg_ipc_server *ipc = NULL;
        CHECK(cberg_ipc_start(&eng, &ipc) == 0, "ipc starts");
        if (ipc != NULL) {
            char resp[8192];
            CHECK(ipc_roundtrip(socket_path, "status\n", resp, sizeof(resp)) == 0, "status roundtrip");
            CHECK(strstr(resp, "\"ready\":true") != NULL, "status ready");
            CHECK(strstr(resp, "\"repos\":[") != NULL, "status has repos array");
            CHECK(strstr(resp, "\"key\":\"alpha\"") != NULL, "status lists alpha");
            CHECK(strstr(resp, "\"key\":\"beta\"") != NULL, "status lists beta");

            /* Chunk-only search is NOT_IMPLEMENTED, but the parse must accept
             * both the 3-field and 4-field (repo-scoped) forms. */
            CHECK(ipc_roundtrip(socket_path, "search\tfoo\t5\n", resp, sizeof(resp)) == 0, "search 3-field");
            CHECK(strstr(resp, "\"ok\":false") != NULL, "chunk-only search errors");
            CHECK(ipc_roundtrip(socket_path, "search\tfoo\t5\talpha\n", resp, sizeof(resp)) == 0, "search 4-field");
            CHECK(strstr(resp, "\"ok\":false") != NULL, "repo-scoped chunk-only search errors");

            cberg_ipc_stop(ipc);
        }
    }
    cberg_engine_close(&eng);

    /* Single-root fallback: CODEBERG_ROOT alone, key = basename. */
    unsetenv("CODEBERG_ROOTS");
    setenv("CODEBERG_ROOT", root_a, 1);
    st = cberg_engine_open(&eng);
    CHECK(st == CBERG_OK, "engine opens from CODEBERG_ROOT");
    if (st == CBERG_OK) {
        CHECK(eng.repos_len == 1, "one repo in fallback mode");
        const char *base = strrchr(root_a, '/');
        base = base != NULL ? base + 1 : root_a;
        CHECK(eng.repos_len == 1 && strcmp(eng.repos[0]->key, base) == 0, "fallback key is basename");
        cberg_engine_close(&eng);
    }

    /* Best-effort cleanup (temp dirs hold a handful of files). */
    char path[512];
    const char *files_a[] = {"a.go", "a2.go"};
    const char *files_b[] = {"b.go", "b2.go"};
    for (size_t i = 0; i < 2; i++) {
        snprintf(path, sizeof(path), "%s/%s", root_a, files_a[i]);
        remove(path);
        snprintf(path, sizeof(path), "%s/%s", root_b, files_b[i]);
        remove(path);
    }
    rmdir(root_a);
    rmdir(root_b);
    unlink(socket_path);

    if (failures == 0) {
        printf("ok - engine\n");
        return 0;
    }
    return 1;
}
