#include "fileio.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

char *cberg_read_file(const char *path, size_t *out_len) {
    if (path == NULL || out_len == NULL) {
        return NULL;
    }
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return NULL;
    }
    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        return NULL;
    }
    long size = ftell(f);
    if (size < 0 || fseek(f, 0, SEEK_SET) != 0) {
        fclose(f);
        return NULL;
    }
    char *buf = malloc((size_t)size + 1);
    if (buf == NULL) {
        fclose(f);
        return NULL;
    }
    size_t got = fread(buf, 1, (size_t)size, f);
    fclose(f);
    buf[got] = '\0';
    *out_len = got;
    return buf;
}

static const char *skip_go_preamble(const char *p) {
    while (*p) {
        while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') {
            p++;
        }
        if (p[0] == '/' && p[1] == '/') {
            while (*p && *p != '\n') {
                p++;
            }
            continue;
        }
        if (p[0] == '/' && p[1] == '*') {
            p += 2;
            while (*p && !(p[0] == '*' && p[1] == '/')) {
                p++;
            }
            if (*p) {
                p += 2;
            }
            continue;
        }
        break;
    }

    return p;
}

int cberg_go_module_path(const char *body, char *out, size_t out_cap) {
    if (out != NULL && out_cap > 0) {
        out[0] = '\0';
    }
    if (body == NULL || out == NULL || out_cap == 0) {
        return 0;
    }

    const char *p = skip_go_preamble(body);
    if (strncmp(p, "module", 6) != 0 || (p[6] != ' ' && p[6] != '\t')) {
        return 0;
    }

    p += 6;
    while (*p == ' ' || *p == '\t') {
        p++;
    }
    if (*p == '"') {
        p++;
    }

    size_t i = 0;
    while (*p && *p != '"' && *p != ' ' && *p != '\t' && *p != '\r' && *p != '\n') {
        if (i + 1 >= out_cap) {
            out[0] = '\0';
            return 0;
        }
        out[i++] = *p++;
    }
    out[i] = '\0';

    return i > 0;
}

int cberg_go_module_owns_import(const char *module, const char *import_path) {
    if (module == NULL || module[0] == '\0' || import_path == NULL) {
        return 0;
    }

    size_t mlen = strlen(module);

    return strncmp(import_path, module, mlen) == 0 &&
           (import_path[mlen] == '\0' || import_path[mlen] == '/');
}
