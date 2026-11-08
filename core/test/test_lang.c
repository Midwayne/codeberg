#include "codeberg/codeberg.h"
#include "lang.h"

#include <stdio.h>
#include <string.h>

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
    CHECK(cberg_language_from_path("main.rs") == CBERG_LANG_RUST, "rs");
    CHECK(cberg_language_from_path("app.rb") == CBERG_LANG_RUBY, "rb");
    CHECK(cberg_language_from_path("build.rake") == CBERG_LANG_RUBY, "rake");
    CHECK(cberg_language_from_path("demo.gemspec") == CBERG_LANG_RUBY, "gemspec");
    CHECK(cberg_language_from_path("README.md") == CBERG_LANG_MARKDOWN, "md");
    CHECK(cberg_language_from_path("doc.markdown") == CBERG_LANG_MARKDOWN, "markdown");
    CHECK(cberg_language_from_path("config.yaml") == CBERG_LANG_YAML, "yaml");
    CHECK(cberg_language_from_path("config.yml") == CBERG_LANG_YAML, "yml");
    CHECK(cberg_language_from_path("Cargo.toml") == CBERG_LANG_TOML, "toml");
    CHECK(cberg_language_from_path("package.json") == CBERG_LANG_JSON, "json");
    CHECK(cberg_language_from_path("photo.png") == CBERG_LANG_UNKNOWN, "unknown");

    CHECK(strcmp(cberg_language_name(CBERG_LANG_GO), "go") == 0, "go name");
    CHECK(strcmp(cberg_language_name(CBERG_LANG_RUBY), "ruby") == 0, "ruby name");
    CHECK(strcmp(cberg_language_name(CBERG_LANG_JSON), "json") == 0, "json name");
    CHECK(strcmp(cberg_language_name(CBERG_LANG_UNKNOWN), "unknown") == 0, "unknown name");
    CHECK(strcmp(cberg_language_name((cberg_language)999), "unknown") == 0, "out-of-range name");

    CHECK(cberg_language_is_code(CBERG_LANG_GO), "go is code");
    CHECK(cberg_language_is_code(CBERG_LANG_RUBY), "ruby is code");
    CHECK(!cberg_language_is_code(CBERG_LANG_MARKDOWN), "markdown is not code");
    CHECK(!cberg_language_is_code(CBERG_LANG_JSON), "json is not code");
    CHECK(!cberg_language_is_code(CBERG_LANG_UNKNOWN), "unknown is not code");
    return failures == 0 ? 0 : 1;
}
