/* A project directory and a repository inside it: each file belongs to one root. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "indexer.h"
#include "indexer_internal.h"

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

static const char *go_src = "package main\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n";

static void write_file(const char *dir, const char *rel, const char *body) {
    char path[512];
    snprintf(path, sizeof(path), "%s/%s", dir, rel);

    FILE *f = fopen(path, "w");
    CHECK(f != NULL, "write file");
    if (f != NULL) {
        fputs(body, f);
        fclose(f);
    }
}

static void step_until_count(cberg_engine *eng, cberg_repo *r, size_t want) {
    for (int i = 0; i < 200 && cberg_repo_chunk_count(r) < want; i++) {
        size_t handled = 0;
        if (cberg_engine_step(eng, &handled) != CBERG_OK) {
            return;
        }

        struct timespec ts = {.tv_sec = 0, .tv_nsec = 50 * 1000000L};
        nanosleep(&ts, NULL);
    }
}

static void settle(cberg_engine *eng) {
    for (int i = 0; i < 20; i++) {
        size_t handled = 0;
        cberg_engine_step(eng, &handled);

        struct timespec ts = {.tv_sec = 0, .tv_nsec = 50 * 1000000L};
        nanosleep(&ts, NULL);
    }
}

static void check_split(cberg_engine *eng, cberg_repo *team, cberg_repo *api) {
    CHECK(team->exclusions.len == 1 && strcmp(team->exclusions.dirs[0], "api") == 0, "team root leaves out api");
    CHECK(api->exclusions.len == 0, "api root excludes nothing");

    CHECK(cberg_repo_bootstrap(team) == CBERG_OK && cberg_repo_bootstrap(api) == CBERG_OK, "both bootstrap");
    eng->bootstrapped = 1;

    size_t team_count = cberg_repo_chunk_count(team);
    size_t api_count = cberg_repo_chunk_count(api);
    CHECK(api_count >= 1, "api has chunks");
    CHECK(team_count == api_count, "team indexes only its own file, not api's");

    char api_dir[512];
    snprintf(api_dir, sizeof(api_dir), "%s", api->root);
    write_file(api_dir, "more.go", go_src);

    step_until_count(eng, api, api_count + 1);
    settle(eng);

    CHECK(cberg_repo_chunk_count(api) > api_count, "api picks up its new file");
    CHECK(cberg_repo_chunk_count(team) == team_count, "team ignores changes inside api");
}

int main(void) {
    char tmpl[] = "/tmp/cberg-nested-XXXXXX";
    char *team_dir = mkdtemp(tmpl);
    CHECK(team_dir != NULL, "mkdtemp");

    char api_dir[512];
    snprintf(api_dir, sizeof(api_dir), "%s/api", team_dir);
    CHECK(mkdir(api_dir, 0777) == 0, "mkdir api");

    write_file(team_dir, "notes.go", go_src);
    write_file(api_dir, "api.go", go_src);

    char socket_path[256];
    snprintf(socket_path, sizeof(socket_path), "/tmp/cberg-nested-%d.sock", (int)getpid());
    unsetenv("CBERG_MODEL");
    unsetenv("CBERG_INDEX_PATH");
    unsetenv("CODEBERG_ROOT");
    setenv("CBERG_SOCKET", socket_path, 1);
    setenv("CBERG_POLL_MS", "50", 1);

    char roots[1200];
    snprintf(roots, sizeof(roots), "team\t%s\napi\t%s\n", team_dir, api_dir);
    setenv("CODEBERG_ROOTS", roots, 1);

    cberg_engine eng;
    CHECK(cberg_engine_open(&eng) == CBERG_OK, "engine opens");
    CHECK(eng.repos_len == 2, "two roots");

    if (eng.repos_len == 2) {
        check_split(&eng, eng.repos[0], eng.repos[1]);
    }
    cberg_engine_close(&eng);

    char cmd[700];
    snprintf(cmd, sizeof(cmd), "rm -rf '%s'", team_dir);
    CHECK(system(cmd) == 0, "cleanup");

    if (failures == 0) {
        printf("ok - nested roots\n");
    }
    return failures == 0 ? 0 : 1;
}
