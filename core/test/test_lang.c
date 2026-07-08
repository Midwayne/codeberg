#include "codeberg/codeberg.h"

#include <stdio.h>

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

int main(void) {
    CHECK(cberg_language_from_path("main.go") == CBERG_LANG_GO, "go");
    CHECK(cberg_language_from_path("lib.ts") == CBERG_LANG_TYPESCRIPT, "ts");
    CHECK(cberg_language_from_path("app.tsx") == CBERG_LANG_TYPESCRIPT, "tsx");
    CHECK(cberg_language_from_path("index.js") == CBERG_LANG_JAVASCRIPT, "js");
    CHECK(cberg_language_from_path("index.mjs") == CBERG_LANG_JAVASCRIPT, "mjs");
    CHECK(cberg_language_from_path("chunker.c") == CBERG_LANG_C, "c");
    CHECK(cberg_language_from_path("Main.java") == CBERG_LANG_JAVA, "java");
    CHECK(cberg_language_from_path("app.py") == CBERG_LANG_PYTHON, "py");
    CHECK(cberg_language_from_path("App.kt") == CBERG_LANG_KOTLIN, "kt");
    CHECK(cberg_language_from_path("README.md") == CBERG_LANG_MARKDOWN, "md");
    CHECK(cberg_language_from_path("doc.markdown") == CBERG_LANG_MARKDOWN, "markdown");
    CHECK(cberg_language_from_path("photo.png") == CBERG_LANG_UNKNOWN, "unknown");
    return failures == 0 ? 0 : 1;
}
