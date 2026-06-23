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
    CHECK(strcmp(cberg_config_index_root_env_name(), "CODEBERG_ROOT") == 0, "env name");

    unsetenv("CODEBERG_ROOT");
    CHECK(cberg_config_index_root() == NULL, "unset root");

    char tmpl[] = "/tmp/cberg-cfg-XXXXXX";
    char *dir = mkdtemp(tmpl);
    CHECK(dir != NULL, "mkdtemp");

    setenv("CODEBERG_ROOT", dir, 1);
    CHECK(cberg_config_index_root() != NULL, "set root");
    CHECK(strcmp(cberg_config_index_root(), dir) == 0, "root value");

    char resolved[4096];
    CHECK(cberg_config_resolve_index_root(resolved, sizeof(resolved)) == CBERG_OK, "resolve ok");
    CHECK(strlen(resolved) > 0, "resolved path");

    unsetenv("CODEBERG_ROOT");
    CHECK(cberg_config_resolve_index_root(resolved, sizeof(resolved)) == CBERG_ERR_NOT_FOUND,
          "resolve missing");

    rmdir(dir);
    return failures == 0 ? 0 : 1;
}
