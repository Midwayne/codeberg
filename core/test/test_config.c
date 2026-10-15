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
    CHECK(strcmp(cberg_config_index_root_env_name(), "CODEBERG_ROOTS") == 0, "internal roots env name");

    unsetenv("CODEBERG_ROOTS");
    setenv("CODEBERG_ROOT", "/obsolete/root", 1);
    CHECK(cberg_config_index_root() == NULL, "removed root setting is ignored");

    char tmpl[] = "/tmp/cberg-cfg-XXXXXX";
    char *dir = mkdtemp(tmpl);
    CHECK(dir != NULL, "mkdtemp");
    if (dir == NULL) {
        return 1;
    }

    char record[4096];
    snprintf(record, sizeof(record), "repo\t%s", dir);
    setenv("CODEBERG_ROOTS", record, 1);
    CHECK(cberg_config_index_root() != NULL, "single keyed root");
    if (cberg_config_index_root() != NULL) {
        CHECK(strcmp(cberg_config_index_root(), dir) == 0, "root path excludes key");
    }

    char resolved[4096] = {0};
    CHECK(cberg_config_resolve_index_root(resolved, sizeof(resolved)) == CBERG_OK, "resolve ok");
    CHECK(strlen(resolved) > 0, "resolved path");

    const char *invalid[] = {"", "no-key", "\t/no-key", "repo\t", "a\t/a\nb\t/b"};
    for (size_t i = 0; i < sizeof(invalid) / sizeof(invalid[0]); i++) {
        setenv("CODEBERG_ROOTS", invalid[i], 1);
        CHECK(cberg_config_index_root() == NULL, "no single keyed root");
        CHECK(cberg_config_resolve_index_root(resolved, sizeof(resolved)) == CBERG_ERR_NOT_FOUND,
              "resolve missing single root");
    }

    unsetenv("CODEBERG_ROOTS");
    unsetenv("CODEBERG_ROOT");
    rmdir(dir);
    return failures == 0 ? 0 : 1;
}
