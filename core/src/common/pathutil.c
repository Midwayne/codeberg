#include "pathutil.h"

#include <string.h>

bool cberg_path_skip_dir(const char *name) {
    if (name == NULL || name[0] == '\0') {
        return false;
    }
    static const char *const skip[] = {
        ".git", "node_modules", "vendor", ".venv", "__pycache__", ".next",
        "dist", "build", "target", ".gradle", ".idea", ".terraform",
    };
    for (size_t i = 0; i < sizeof(skip) / sizeof(skip[0]); i++) {
        if (strcmp(name, skip[i]) == 0) {
            return true;
        }
    }
    return false;
}

bool cberg_path_join(const char *root, const char *rel, char *out, size_t out_cap) {
    if (root == NULL || rel == NULL || out == NULL || out_cap == 0) {
        return false;
    }
    size_t root_len = strlen(root);
    size_t rel_len = strlen(rel);
    int need_sep = root_len > 0 && root[root_len - 1] != '/' && rel[0] != '/';
    size_t total = root_len + (need_sep ? 1 : 0) + rel_len;
    if (total + 1 > out_cap) {
        return false;
    }
    memcpy(out, root, root_len);
    size_t at = root_len;
    if (need_sep) {
        out[at++] = '/';
    }
    memcpy(out + at, rel, rel_len);
    out[at + rel_len] = '\0';
    return true;
}
