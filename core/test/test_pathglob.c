/* Path globs follow ripgrep's --glob (gitignore) semantics so the vector and
 * lexical halves of hybrid search scope results the same way. Expectations
 * below were recorded from `rg -l --glob <pattern>` over the same paths. */
#include "pathglob.h"
#include "test_common.h"

#include <stdio.h>
#include <string.h>

static const char *const PATHS[] = {
    "a.go",
    "daemon/main.go",
    "daemon/internal/x.go",
    "daemon/internal/tools/t.go",
    "core/src/c.c",
    "core/README.md",
    "vendor/x/v.go",
};

#define N_PATHS (sizeof(PATHS) / sizeof(PATHS[0]))

typedef struct {
    const char *glob;
    const char *matches; /* space-separated, in PATHS order */
} glob_case;

static const glob_case CASES[] = {
    {"*.go", "a.go daemon/main.go daemon/internal/x.go daemon/internal/tools/t.go vendor/x/v.go"},
    {"**/*.go", "a.go daemon/main.go daemon/internal/x.go daemon/internal/tools/t.go vendor/x/v.go"},
    {"daemon/**", "daemon/main.go daemon/internal/x.go daemon/internal/tools/t.go"},
    {"daemon/*", "daemon/main.go"},
    {"daemon", ""},
    {"daemon/internal", ""},
    {"internal", ""},
    {"*.{go,c}", "a.go daemon/main.go daemon/internal/x.go daemon/internal/tools/t.go core/src/c.c vendor/x/v.go"},
    {"daemon/**/*.go", "daemon/main.go daemon/internal/x.go daemon/internal/tools/t.go"},
    {"/a.go", "a.go"},
    {"a.go", "a.go"},
    {"core/*.md", "core/README.md"},
    {"!vendor/**", "a.go daemon/main.go daemon/internal/x.go daemon/internal/tools/t.go core/src/c.c core/README.md"},
    {"src/*.c", ""},
    {"**/src/*.c", "core/src/c.c"},
    {"daemon/", ""},
    {"*/main.go", "daemon/main.go"},
    {"tools/*.go", ""},
    {"d*/*.go", "daemon/main.go"},
    {"[cd]*/**", "daemon/main.go daemon/internal/x.go daemon/internal/tools/t.go core/src/c.c core/README.md"},
};

static void check_case(const glob_case *c) {
    char got[1024] = "";
    size_t off = 0;

    for (size_t i = 0; i < N_PATHS; i++) {
        if (cberg_path_glob_match(c->glob, PATHS[i])) {
            off += (size_t)snprintf(got + off, sizeof(got) - off, "%s%s", off > 0 ? " " : "", PATHS[i]);
        }
    }

    if (strcmp(got, c->matches) != 0) {
        fprintf(stderr, "FAIL: glob %s\n  want: %s\n  got:  %s\n", c->glob, c->matches, got);
        failures++;
    }
}

int main(void) {
    for (size_t i = 0; i < sizeof(CASES) / sizeof(CASES[0]); i++) {
        check_case(&CASES[i]);
    }

    CHECK(cberg_path_glob_match("", "a.go"), "empty glob matches everything");
    CHECK(!cberg_path_glob_match("*.go", "a.goo"), "suffix must match");
    CHECK(cberg_path_glob_match("{daemon,core}/**/*.{go,c}", "core/src/c.c"), "nested braces");
    CHECK(!cberg_path_glob_match("{daemon,core}/**/*.{go,c}", "vendor/x/v.go"), "nested braces reject");
    CHECK(cberg_path_glob_match("**", "deep/er/path.txt"), "bare ** matches all");
    CHECK(cberg_path_glob_match(".*", ".github"), "dotfiles match *");

    TEST_MAIN_RETURN
}
