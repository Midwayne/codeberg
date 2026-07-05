#include "codeberg/codeberg.h"

#include <stddef.h>
#include <string.h>

int cberg_walk_skip_dir(const char *name) {
    if (name == NULL || name[0] == '\0') {
        return 0;
    }
    static const char *const skip[] = {
        ".git",
        "node_modules",
        "vendor",
        ".venv",
        "__pycache__",
        ".next",
        "dist",
        "build",
        "target",
        ".gradle",
        ".idea",
        ".terraform",
    };
    for (size_t i = 0; i < sizeof(skip) / sizeof(skip[0]); i++) {
        if (strcmp(name, skip[i]) == 0) {
            return 1;
        }
    }
    return 0;
}
