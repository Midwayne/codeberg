#include "lang.h"

#include <string.h>

typedef struct {
    cberg_language lang;
    const char *name;
    const char *const *exts; /* NULL-terminated */
} lang_row;

#define EXTS(...) ((const char *const[]){__VA_ARGS__, NULL})

/* Indexed by cberg_language; one row per enum value. */
static const lang_row k_langs[] = {
    {CBERG_LANG_UNKNOWN, "unknown", EXTS(NULL)},
    {CBERG_LANG_GO, "go", EXTS("go")},
    {CBERG_LANG_TYPESCRIPT, "typescript", EXTS("ts", "tsx")},
    {CBERG_LANG_JAVASCRIPT, "javascript", EXTS("js", "jsx", "mjs", "cjs")},
    {CBERG_LANG_C, "c", EXTS("c", "h")},
    {CBERG_LANG_KOTLIN, "kotlin", EXTS("kt", "kts")},
    {CBERG_LANG_PYTHON, "python", EXTS("py", "pyi")},
    {CBERG_LANG_JAVA, "java", EXTS("java")},
    {CBERG_LANG_RUST, "rust", EXTS("rs")},
    {CBERG_LANG_RUBY, "ruby", EXTS("rb", "rake", "gemspec")},
    {CBERG_LANG_MARKDOWN, "markdown", EXTS("md", "markdown")},
    {CBERG_LANG_YAML, "yaml", EXTS("yaml", "yml")},
    {CBERG_LANG_TOML, "toml", EXTS("toml")},
    {CBERG_LANG_JSON, "json", EXTS("json")},
};

#define LANG_COUNT (sizeof(k_langs) / sizeof(k_langs[0]))

_Static_assert(LANG_COUNT == (size_t)CBERG_LANG_JSON + 1, "add a k_langs row for every cberg_language");
_Static_assert(CBERG_LANG_PARSED_LAST + 1 == CBERG_LANG_MARKDOWN, "parsed languages precede document formats");

static const lang_row *row_for(cberg_language lang) {
    if ((size_t)lang >= LANG_COUNT) {
        return &k_langs[CBERG_LANG_UNKNOWN];
    }
    return &k_langs[lang];
}

const char *cberg_language_name(cberg_language lang) {
    return row_for(lang)->name;
}

int cberg_language_is_code(cberg_language lang) {
    return lang > CBERG_LANG_UNKNOWN && lang <= CBERG_LANG_PARSED_LAST;
}

cberg_language cberg_language_from_path(const char *path) {
    if (path == NULL) {
        return CBERG_LANG_UNKNOWN;
    }

    const char *dot = strrchr(path, '.');
    if (dot == NULL || dot[1] == '\0') {
        return CBERG_LANG_UNKNOWN;
    }

    const char *ext = dot + 1;
    for (size_t i = 0; i < LANG_COUNT; i++) {
        for (const char *const *e = k_langs[i].exts; *e != NULL; e++) {
            if (strcmp(ext, *e) == 0) {
                return k_langs[i].lang;
            }
        }
    }
    return CBERG_LANG_UNKNOWN;
}
