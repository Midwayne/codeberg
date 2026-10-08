/* Exercises hit resolution in chunk-only mode: outline and find_symbol hits
 * carry the chunk kind, snippets hold the chunk's leading bytes (truncated to
 * CBERG_SNIPPET_MAX - 1), and a span that no longer fits the file on disk
 * yields an empty snippet instead of stale bytes. */
#include "indexer.h"
#include "ipc.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
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

#define LONG_BODY_BYTES 600

static const char *add_src = "func Add(a, b int) int {\n\treturn a + b\n}";

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

static char *long_func(void) {
    size_t cap = LONG_BODY_BYTES + 128;
    char *fn = malloc(cap);
    int n = snprintf(fn, cap, "func Long() string {\n\treturn \"");

    memset(fn + n, 'x', LONG_BODY_BYTES);
    snprintf(fn + n + LONG_BODY_BYTES, cap - (size_t)n - LONG_BODY_BYTES, "\"\n}");
    return fn;
}

static const cberg_engine_hit *hit_named(const cberg_engine_hit *hits, size_t n, const char *symbol) {
    for (size_t i = 0; i < n; i++) {
        if (strcmp(hits[i].symbol, symbol) == 0) {
            return &hits[i];
        }
    }
    return NULL;
}

static void check_outline(cberg_engine *eng, const char *long_src) {
    cberg_engine_hit hits[8];
    size_t found = 0;

    CHECK(cberg_engine_file_outline(eng, eng->repos[0]->key, "a.go", hits, 8, &found) == CBERG_OK, "outline");
    CHECK(found == 2, "outline lists both functions");

    const cberg_engine_hit *add = hit_named(hits, found, "Add");
    CHECK(add != NULL && strcmp(add->snippet, add_src) == 0, "short snippet is the whole chunk");
    CHECK(add != NULL && strcmp(add->kind, "function") == 0, "outline hit carries kind");

    const cberg_engine_hit *lng = hit_named(hits, found, "Long");
    CHECK(lng != NULL && strlen(lng->snippet) == CBERG_SNIPPET_MAX - 1, "long snippet truncated");
    CHECK(lng != NULL && strncmp(lng->snippet, long_src, CBERG_SNIPPET_MAX - 1) == 0, "long snippet is the chunk prefix");
}

static void check_find_symbol(cberg_engine *eng) {
    cberg_engine_hit hits[4];
    size_t found = 0;

    CHECK(cberg_engine_find_symbol(eng, "Add", NULL, -1, 4, hits, 4, &found) == CBERG_OK, "find_symbol");
    CHECK(found == 1, "find_symbol hit");
    CHECK(found == 1 && strcmp(hits[0].kind, "function") == 0, "find_symbol hit carries kind");
    CHECK(found == 1 && strcmp(hits[0].snippet, add_src) == 0, "find_symbol snippet");
}

static void check_shrunk_file(cberg_engine *eng, const char *root) {
    cberg_engine_hit hits[8];
    size_t found = 0;

    write_file(root, "a.go", "package main\n");

    CHECK(cberg_engine_file_outline(eng, eng->repos[0]->key, "a.go", hits, 8, &found) == CBERG_OK, "outline after shrink");

    const cberg_engine_hit *lng = hit_named(hits, found, "Long");
    CHECK(lng != NULL && lng->snippet[0] == '\0', "span past EOF yields empty snippet");
}

/* Sends one request and reads the whole response (the server closes after it). */
static char *ipc_request(const char *socket_path, const char *req, size_t *out_len) {
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
        return NULL;
    }

    struct timeval tv = {.tv_sec = 5, .tv_usec = 0};
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    struct sockaddr_un addr = {0};
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, socket_path, sizeof(addr.sun_path) - 1);
    if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0 || write(fd, req, strlen(req)) < 0) {
        close(fd);
        return NULL;
    }

    size_t cap = 1 << 20;
    size_t len = 0;
    char *buf = malloc(cap + 1);
    ssize_t n;
    while (len < cap && (n = read(fd, buf + len, cap - len)) > 0) {
        len += (size_t)n;
    }
    close(fd);

    buf[len] = '\0';
    *out_len = len;
    return buf;
}

static void hang_up_after_request(const char *socket_path, const char *req) {
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
        return;
    }

    struct sockaddr_un addr = {0};
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, socket_path, sizeof(addr.sun_path) - 1);
    if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) == 0 && write(fd, req, strlen(req)) < 0) {
        fprintf(stderr, "warning: request write failed\n");
    }
    close(fd);
}

static size_t count_substr(const char *s, const char *needle) {
    size_t n = 0;
    for (const char *p = strstr(s, needle); p != NULL; p = strstr(p + 1, needle)) {
        n++;
    }
    return n;
}

static int has_raw_control(const char *s, size_t len) {
    for (size_t i = 0; i + 1 < len; i++) {
        if ((unsigned char)s[i] < 0x20) {
            return 1;
        }
    }
    return 0;
}

/* Every snippet is all quotes and backslashes, so each escaped hit is about
 * twice its raw size and the outline overflows the response buffer. */
static void write_dense_file(const char *root) {
    size_t cap = 256 * 1024;
    char *src = malloc(cap);
    size_t off = (size_t)snprintf(src, cap, "package main\n\n");

    for (int i = 0; i < 200; i++) {
        off += (size_t)snprintf(src + off, cap - off, "func Dense%03d() string {\n\treturn \"", i);
        for (int j = 0; j < 150; j++) {
            off += (size_t)snprintf(src + off, cap - off, "\\\"");
        }
        off += (size_t)snprintf(src + off, cap - off, "\"\n}\n\n");
    }

    write_file(root, "dense.go", src);
    free(src);
}

static void check_ipc(cberg_engine *eng, const char *sock) {
    cberg_ipc_server *ipc = NULL;
    CHECK(cberg_ipc_start(eng, &ipc) == 0, "ipc starts");
    if (ipc == NULL) {
        return;
    }

    char req[512];
    size_t len = 0;

    snprintf(req, sizeof(req), "outline\t%s\tdense.go\n", eng->repos[0]->key);
    char *resp = ipc_request(sock, req, &len);
    const char *prefix = "{\"ok\":true,\"results\":[{";
    CHECK(resp != NULL && strncmp(resp, prefix, strlen(prefix)) == 0, "dense outline ok");
    CHECK(resp != NULL && len >= 4 && strcmp(resp + len - 4, "}]}\n") == 0, "dense outline ends on a whole hit");
    CHECK(resp != NULL && count_substr(resp, "\"symbol\":\"Dense") == 200, "dense outline lists every function");
    free(resp);

    resp = ipc_request(sock, "symbol\tDense\t\t\t64\n", &len);
    CHECK(resp != NULL && len >= 4 && strcmp(resp + len - 4, "}]}\n") == 0, "dense symbol hits end on a whole hit");
    CHECK(resp != NULL && count_substr(resp, "\"symbol\":\"Dense") == 64, "dense symbol lists every hit");
    free(resp);

    snprintf(req, sizeof(req), "outline\t%s\tctl.go\n", eng->repos[0]->key);
    resp = ipc_request(sock, req, &len);
    CHECK(resp != NULL && strstr(resp, "\"ok\":true") != NULL, "control-char outline ok");
    CHECK(resp != NULL && !has_raw_control(resp, len), "control chars escaped");
    CHECK(resp != NULL && strstr(resp, "\\u000c") != NULL && strstr(resp, "\\u001b") != NULL, "control chars as \\u escapes");
    free(resp);

    /* A client that hangs up before reading must not take the indexer down
     * with SIGPIPE (this test process is the indexer). */
    for (int i = 0; i < 5; i++) {
        snprintf(req, sizeof(req), "outline\t%s\tdense.go\n", eng->repos[0]->key);
        hang_up_after_request(sock, req);
    }
    struct timespec settle = {.tv_sec = 0, .tv_nsec = 200 * 1000000L};
    nanosleep(&settle, NULL);

    resp = ipc_request(sock, "symbol\tAdd\n", &len);
    CHECK(resp != NULL && strstr(resp, "\"symbol\":\"Add\",\"kind\":\"function\"") != NULL, "symbol results carry kind");
    free(resp);

    cberg_ipc_stop(ipc);
}

int main(void) {
    char root_tmpl[] = "/tmp/cberg-hits-root-XXXXXX";
    char *root = mkdtemp(root_tmpl);
    if (root == NULL) {
        fprintf(stderr, "FAIL: mkdtemp\n");
        return 1;
    }

    char *long_src = long_func();
    char *src = malloc(strlen(add_src) + strlen(long_src) + 64);
    sprintf(src, "package main\n\n%s\n\n%s\n", add_src, long_src);
    write_file(root, "a.go", src);
    write_file(root, "ctl.go", "package main\n\nfunc Ctl() {\n\t// page\f break \x1b[0m\n}\n");
    write_dense_file(root);

    char sock[512];
    snprintf(sock, sizeof(sock), "%s/sock", root);

    unsetenv("CODEBERG_ROOTS");
    unsetenv("CBERG_MODEL");
    unsetenv("CBERG_INDEX_PATH");
    setenv("CODEBERG_ROOT", root, 1);
    setenv("CBERG_SOCKET", sock, 1);
    setenv("CBERG_POLL_MS", "50", 1);

    cberg_engine eng;
    cberg_status st = cberg_engine_open(&eng);
    CHECK(st == CBERG_OK, "engine opens");
    if (st == CBERG_OK) {
        CHECK(cberg_repo_bootstrap(eng.repos[0]) == CBERG_OK, "bootstrap");
        eng.bootstrapped = 1;

        check_outline(&eng, long_src);
        check_find_symbol(&eng);
        check_ipc(&eng, sock);
        check_shrunk_file(&eng, root);

        cberg_engine_close(&eng);
    }

    char cmd[600];
    snprintf(cmd, sizeof(cmd), "rm -rf '%s'", root);
    if (system(cmd) != 0) {
        fprintf(stderr, "warning: could not remove %s\n", root);
    }

    free(src);
    free(long_src);

    if (failures == 0) {
        printf("ok - hits\n");
    }
    return failures == 0 ? 0 : 1;
}
