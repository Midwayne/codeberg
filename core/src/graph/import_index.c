/*
 * Import index: walks a repository for source files, reads go.mod for the
 * module path, and maps each language's import strings (JS/TS paths, Python
 * dotted modules, Rust crate paths) to the repo-relative files they name.
 * resolve_pkg.c matches IMPORTS edges against it.
 */
#include "codeberg/codeberg.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "arena.h"
#include "fileio.h"
#include "graph_internal.h"
#include "import_index.h"
#include "pathutil.h"
#include "strmap.h"
#include "walk_policy.h"

static cberg_status pkg_add_file(pkg_index *idx, const char *rel) {
    size_t cap = idx->file_cap == 0 ? 64 : idx->file_cap;
    while (cap < idx->file_len + 1) {
        cap *= 2;
    }
    if (cap != idx->file_cap) {
        char **grown = realloc(idx->file_paths, cap * sizeof(*grown));
        if (grown == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        idx->file_paths = grown;
        idx->file_cap = cap;
    }
    char *copy = cberg_arena_strdup(idx->arena, rel);
    if (copy == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    idx->file_paths[idx->file_len++] = copy;
    return cberg_strmap_set(idx->file_set, copy, 1);
}

/* Code languages only — not markdown/yaml/toml/json (those are UNKNOWN for imports). */
int graph_is_code_source(const char *rel) {
    cberg_language lang = cberg_language_from_path(rel);
    return lang != CBERG_LANG_UNKNOWN && lang != CBERG_LANG_MARKDOWN && lang != CBERG_LANG_YAML &&
           lang != CBERG_LANG_TOML && lang != CBERG_LANG_JSON;
}

static int walk_cb(const char *abs, const char *rel, void *v) {
    (void)abs;
    pkg_index *idx = v;
    if (!graph_is_code_source(rel)) {
        return 0;
    }
    cberg_status st = pkg_add_file(idx, rel);
    if (st != CBERG_OK) {
        idx->err = st;
        return -1;
    }
    return 0;
}

static void map_put(pkg_index *idx, const char *key, const char *file) {
    if (key == NULL || file == NULL || key[0] == '\0') {
        return;
    }
    /* First mapping wins — prefer earlier / more specific files. */
    if (cberg_strmap_get(idx->import_to_file, key, NULL)) {
        return;
    }
    const char *k = cberg_arena_strdup(idx->arena, key);
    const char *v = cberg_arena_strdup(idx->arena, file);
    if (k != NULL && v != NULL) {
        (void)cberg_strmap_set(idx->import_to_file, k, (uint64_t)(uintptr_t)v);
    }
}

static void map_path_without_ext(pkg_index *idx, const char *rel) {
    const char *dot = strrchr(rel, '.');
    if (dot == NULL) {
        return;
    }
    char key[512];
    size_t klen = (size_t)(dot - rel);
    if (klen + 1 >= sizeof key) {
        return;
    }
    memcpy(key, rel, klen);
    key[klen] = '\0';
    map_put(idx, key, rel);
    char dotted[520];
    snprintf(dotted, sizeof dotted, "./%s", key);
    map_put(idx, dotted, rel);
}

static void scan_go_mod(pkg_index *idx, const char *root) {
    char path[4096];
    snprintf(path, sizeof path, "%s/go.mod", root);
    size_t len = 0;
    char *body = cberg_read_file(path, &len);
    if (body == NULL) {
        return;
    }
    /* Skip leading blank lines and // comments before `module`. */
    const char *p = body;
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
            while (p[0] && !(p[0] == '*' && p[1] == '/')) {
                p++;
            }
            if (p[0]) {
                p += 2;
            }
            continue;
        }
        break;
    }
    if (strncmp(p, "module ", 7) == 0) {
        p += 7;
        size_t i = 0;
        while (*p && *p != '\n' && *p != '\r' && i + 1 < sizeof idx->go_module) {
            idx->go_module[i++] = *p++;
        }
        idx->go_module[i] = '\0';
    }
    free(body);
    if (idx->go_module[0] == '\0') {
        return;
    }
    size_t mlen = strlen(idx->go_module);
    for (size_t i = 0; i < idx->file_len; i++) {
        const char *rel = idx->file_paths[i];
        size_t rlen = strlen(rel);
        if (rlen < 3 || strcmp(rel + rlen - 3, ".go") != 0) {
            continue;
        }
        char key[1024];
        const char *slash = strrchr(rel, '/');
        if (slash != NULL) {
            size_t dlen = (size_t)(slash - rel);
            if (mlen + 1 + dlen + 1 < sizeof key) {
                memcpy(key, idx->go_module, mlen);
                key[mlen] = '/';
                memcpy(key + mlen + 1, rel, dlen);
                key[mlen + 1 + dlen] = '\0';
                map_put(idx, key, rel);
            }
        } else {
            map_put(idx, idx->go_module, rel);
        }
    }
}

/* Map JS/TS sources by path (package.json names are never remapped — false-positive risk). */
static void map_js_sources(pkg_index *idx) {
    for (size_t i = 0; i < idx->file_len; i++) {
        const char *rel = idx->file_paths[i];
        const char *dot = strrchr(rel, '.');
        if (dot == NULL) {
            continue;
        }
        if (strcmp(dot, ".ts") != 0 && strcmp(dot, ".tsx") != 0 && strcmp(dot, ".js") != 0 && strcmp(dot, ".jsx") != 0) {
            continue;
        }
        map_path_without_ext(idx, rel);
    }
}

static void map_python_sources(pkg_index *idx) {
    for (size_t i = 0; i < idx->file_len; i++) {
        const char *rel = idx->file_paths[i];
        size_t rlen = strlen(rel);
        if (rlen < 3 || strcmp(rel + rlen - 3, ".py") != 0) {
            continue;
        }
        char key[512];
        size_t klen = rlen - 3;
        if (klen + 1 >= sizeof key) {
            continue;
        }
        memcpy(key, rel, klen);
        key[klen] = '\0';
        for (size_t j = 0; j < klen; j++) {
            if (key[j] == '/') {
                key[j] = '.';
            }
        }
        size_t kl = strlen(key);
        if (kl >= 9 && strcmp(key + kl - 9, ".__init__") == 0) {
            key[kl - 9] = '\0';
        }
        /* Only multi-segment or path-derived keys (never bare stdlib names alone
         * unless the file itself is that name — gated at resolve time). */
        map_put(idx, key, rel);
        map_path_without_ext(idx, rel);
    }
}

/* Map Rust sources by path / crate:: segments (Cargo.toml crate name is not remapped). */
static void map_rust_sources(pkg_index *idx) {
    for (size_t i = 0; i < idx->file_len; i++) {
        const char *rel = idx->file_paths[i];
        const char *dot = strrchr(rel, '.');
        if (dot == NULL || strcmp(dot, ".rs") != 0) {
            continue;
        }
        map_path_without_ext(idx, rel);
        /* crate::path::to::mod from path segments (skip "src/" prefix). */
        const char *start = rel;
        if (strncmp(rel, "src/", 4) == 0) {
            start = rel + 4;
        }
        char crate_key[520];
        size_t off = (size_t)snprintf(crate_key, sizeof crate_key, "crate::");
        for (const char *s = start; s < dot && off + 2 < sizeof crate_key; s++) {
            if (*s == '/') {
                crate_key[off++] = ':';
                crate_key[off++] = ':';
            } else {
                crate_key[off++] = *s;
            }
        }
        crate_key[off] = '\0';
        map_put(idx, crate_key, rel);
    }
}

void cberg_import_cache_free(cberg_import_cache *cache) {
    if (cache == NULL) {
        return;
    }
    free(cache->file_paths);
    cberg_strmap_free(cache->file_set);
    cberg_strmap_free(cache->import_to_file);
    cberg_arena_free(cache->arena);
    free(cache);
}

void cberg_import_cache_note(cberg_import_cache **cache, const char *path, int deleted) {
    if (cache == NULL || *cache == NULL) {
        return;
    }
    uint64_t present = 0;
    if (!deleted && cberg_strmap_get((*cache)->file_set, path, &present)) {
        return;
    }
    /* New/deleted paths, manifests and directory events may change resolution.
     * Do not trust CREATE alone: watcher coalescing can turn it into MODIFY. */
    cberg_import_cache_free(*cache);
    *cache = NULL;
}

cberg_status graph_import_index_build(const char *root, cberg_import_cache **out) {
    pkg_index *idx = calloc(1, sizeof(*idx));
    if (idx == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    idx->arena = cberg_arena_new();
    idx->file_set = cberg_strmap_new(1024);
    idx->import_to_file = cberg_strmap_new(1024);
    if (idx->arena == NULL || idx->file_set == NULL || idx->import_to_file == NULL) {
        cberg_import_cache_free(idx);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    if (cberg_fs_walk_files(root, walk_cb, idx) != 0) {
        cberg_status st = idx->err != CBERG_OK ? idx->err : CBERG_ERR_IO;
        cberg_import_cache_free(idx);
        return st;
    }
    scan_go_mod(idx, root);
    map_js_sources(idx);
    map_python_sources(idx);
    map_rust_sources(idx);
    *out = idx;
    return CBERG_OK;
}
