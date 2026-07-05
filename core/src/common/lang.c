#include "codeberg/codeberg.h"

#include <string.h>

cberg_language cberg_language_from_path(const char *path) {
    if (path == NULL) {
        return CBERG_LANG_UNKNOWN;
    }
    const char *dot = strrchr(path, '.');
    if (dot == NULL || dot[1] == '\0') {
        return CBERG_LANG_UNKNOWN;
    }
    const char *ext = dot + 1;
    struct {
        const char *ext;
        cberg_language lang;
    } table[] = {
        {"go", CBERG_LANG_GO},
        {"ts", CBERG_LANG_TYPESCRIPT},
        {"tsx", CBERG_LANG_TYPESCRIPT},
        {"js", CBERG_LANG_JAVASCRIPT},
        {"jsx", CBERG_LANG_JAVASCRIPT},
        {"mjs", CBERG_LANG_JAVASCRIPT},
        {"cjs", CBERG_LANG_JAVASCRIPT},
        {"c", CBERG_LANG_C},
        {"h", CBERG_LANG_C},
        {"kt", CBERG_LANG_KOTLIN},
        {"kts", CBERG_LANG_KOTLIN},
        {"py", CBERG_LANG_PYTHON},
        {"pyi", CBERG_LANG_PYTHON},
        {"java", CBERG_LANG_JAVA},
    };
    for (size_t i = 0; i < sizeof(table) / sizeof(table[0]); i++) {
        if (strcmp(ext, table[i].ext) == 0) {
            return table[i].lang;
        }
    }
    return CBERG_LANG_UNKNOWN;
}
