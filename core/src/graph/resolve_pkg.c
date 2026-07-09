/*
 * Phase 2 package-manifest import resolution. Scans go.mod / package.json /
 * pyproject / Cargo.toml under a repo root and rewrites IMPORTS edges whose
 * module string maps to a repo-relative source file so they target that FILE
 * node with resolution=import.
 *
 * Safety: bare identifiers (fmt, json, os) and slash-form stdlib/npm packages
 * (encoding/json) are never rewritten — only relative imports (./, ../), Rust
 * `::` paths, Go module-prefixed paths, multi-segment dotted names, or
 * source-file paths (…/*.h) are candidates. Manifest scanners never map
 * package-name → first file.
 */
#include "codeberg/codeberg.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "arena.h"
#include "fileio.h"
#include "graph_internal.h"
#include "pathutil.h"
#include "strmap.h"
#include "walk_policy.h"

typedef struct {
    cberg_strmap *import_to_file; /* import string -> arena path */
    cberg_arena *arena;
    char **file_paths; /* all indexed-looking source paths (rel) */
    size_t file_len;
    size_t file_cap;
    char go_module[512]; /* from go.mod, empty if absent */
} pkg_index;

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
    return CBERG_OK;
}

static int is_source_rel(const char *rel) {
    const char *dot = strrchr(rel, '.');
    if (dot == NULL) {
        return 0;
    }
    return strcmp(dot, ".go") == 0 || strcmp(dot, ".ts") == 0 || strcmp(dot, ".tsx") == 0 || strcmp(dot, ".js") == 0 ||
           strcmp(dot, ".jsx") == 0 || strcmp(dot, ".py") == 0 || strcmp(dot, ".rs") == 0 || strcmp(dot, ".c") == 0 ||
           strcmp(dot, ".h") == 0 || strcmp(dot, ".rb") == 0 || strcmp(dot, ".java") == 0 || strcmp(dot, ".kt") == 0;
}

static int walk_cb(const char *abs, const char *rel, void *v) {
    (void)abs;
    pkg_index *idx = v;
    if (!is_source_rel(rel)) {
        return 0;
    }
    return pkg_add_file(idx, rel) == CBERG_OK ? 0 : -1;
}

static int import_is_relative(const char *imp) {
    return imp[0] == '.' && (imp[1] == '/' || imp[1] == '\\' ||
                             (imp[1] == '.' && (imp[2] == '/' || imp[2] == '\\')));
}

static int import_has_source_ext(const char *imp) {
    const char *dot = strrchr(imp, '.');
    if (dot == NULL || strchr(dot, '/') != NULL || strchr(dot, '\\') != NULL) {
        return 0;
    }
    return strcmp(dot, ".h") == 0 || strcmp(dot, ".c") == 0 || strcmp(dot, ".hpp") == 0 || strcmp(dot, ".hh") == 0 ||
           strcmp(dot, ".go") == 0 || strcmp(dot, ".ts") == 0 || strcmp(dot, ".tsx") == 0 || strcmp(dot, ".js") == 0 ||
           strcmp(dot, ".jsx") == 0 || strcmp(dot, ".py") == 0 || strcmp(dot, ".rs") == 0 || strcmp(dot, ".rb") == 0;
}

/* True when the import string is safe to attempt local resolution.
 * Slash-form stdlib (encoding/json) and npm packages are NOT candidates unless
 * they are relative, Go-module-prefixed, or look like a source file path. */
static int import_is_resolvable_shape(const char *imp, const char *go_module) {
    if (imp == NULL || imp[0] == '\0') {
        return 0;
    }
    if (import_is_relative(imp)) {
        return 1;
    }
    /* Rust paths: crate::mod, self::, super:: */
    if (strstr(imp, "::") != NULL) {
        return 1;
    }
    /* Go module-prefixed path. */
    if (go_module != NULL && go_module[0] != '\0') {
        size_t mlen = strlen(go_module);
        if (strncmp(imp, go_module, mlen) == 0 && (imp[mlen] == '\0' || imp[mlen] == '/')) {
            return 1;
        }
    }
    int has_slash = strchr(imp, '/') != NULL || strchr(imp, '\\') != NULL;
    if (has_slash) {
        /* Quoted C includes and explicit file paths only — not encoding/json. */
        return import_has_source_ext(imp);
    }
    /* Multi-segment dotted (Python pkg.sub) — not bare stdlib names. */
    if (strchr(imp, '.') != NULL) {
        return 1;
    }
    /* Bare identifier: stdlib / external package name — never rewrite. */
    return 0;
}

/* Map relative / path-like imports onto the first matching source file. */
static const char *find_file_for_import(pkg_index *idx, const char *imp) {
    if (imp == NULL || imp[0] == '\0') {
        return NULL;
    }
    const char *needle = imp;
    while (needle[0] == '.' && (needle[1] == '/' || needle[1] == '\\')) {
        needle += 2;
    }
    /* Strip a single leading "../" chain for relative lookups. */
    while (needle[0] == '.' && needle[1] == '.' && (needle[2] == '/' || needle[2] == '\\')) {
        needle += 3;
    }
    size_t nlen = strlen(needle);
    if (nlen == 0) {
        return NULL;
    }
    for (size_t i = 0; i < idx->file_len; i++) {
        const char *p = idx->file_paths[i];
        const char *dot = strrchr(p, '.');
        size_t plen = dot != NULL ? (size_t)(dot - p) : strlen(p);
        if (plen == nlen && strncmp(p, needle, nlen) == 0) {
            return p;
        }
        if (plen > nlen && p[plen - nlen - 1] == '/' && strncmp(p + plen - nlen, needle, nlen) == 0) {
            return p;
        }
        /* Directory package: needle/xxx.ext (Go packages, Python packages). */
        if (strncmp(p, needle, nlen) == 0 && p[nlen] == '/') {
            return p;
        }
    }
    return NULL;
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

static void scan_json_deps(pkg_index *idx, const char *root, const char *rel_manifest) {
    char path[4096];
    snprintf(path, sizeof path, "%s/%s", root, rel_manifest);
    size_t len = 0;
    char *body = cberg_read_file(path, &len);
    if (body != NULL) {
        free(body); /* package name is not mapped onto a file (false-positive risk). */
    }
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

static void scan_pyproject(pkg_index *idx, const char *root) {
    char path[4096];
    snprintf(path, sizeof path, "%s/pyproject.toml", root);
    size_t len = 0;
    char *body = cberg_read_file(path, &len);
    if (body != NULL) {
        free(body);
    }
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

static void scan_cargo(pkg_index *idx, const char *root) {
    char path[4096];
    snprintf(path, sizeof path, "%s/Cargo.toml", root);
    size_t len = 0;
    char *body = cberg_read_file(path, &len);
    if (body != NULL) {
        free(body); /* crate name is not mapped onto arbitrary .rs files. */
    }
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

cberg_status cberg_graph_resolve_imports(cberg_graph *graph, const char *repo_root) {
    if (graph == NULL || repo_root == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    pkg_index idx = {0};
    idx.arena = cberg_arena_new();
    idx.import_to_file = cberg_strmap_new(1024);
    if (idx.arena == NULL || idx.import_to_file == NULL) {
        cberg_arena_free(idx.arena);
        cberg_strmap_free(idx.import_to_file);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    if (cberg_fs_walk_files(repo_root, walk_cb, &idx) != 0) {
        /* Partial index is fine; continue with what we have. */
    }
    scan_go_mod(&idx, repo_root);
    scan_json_deps(&idx, repo_root, "package.json");
    scan_pyproject(&idx, repo_root);
    scan_cargo(&idx, repo_root);

    size_t node_count = 0;
    cberg_graph_counts(graph, &node_count, NULL);
    if (node_count == 0) {
        free(idx.file_paths);
        cberg_strmap_free(idx.import_to_file);
        cberg_arena_free(idx.arena);
        return CBERG_OK;
    }
    const cberg_graph_node **files = calloc(node_count, sizeof(*files));
    if (files == NULL) {
        free(idx.file_paths);
        cberg_strmap_free(idx.import_to_file);
        cberg_arena_free(idx.arena);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t nfiles = 0;
    cberg_status st = cberg_graph_find_nodes(graph, NULL, CBERG_GNODE_MASK(CBERG_GNODE_FILE), NULL, files, node_count, &nfiles);
    if (st != CBERG_OK) {
        free(files);
        free(idx.file_paths);
        cberg_strmap_free(idx.import_to_file);
        cberg_arena_free(idx.arena);
        return st;
    }
    for (size_t i = 0; i < nfiles; i++) {
        cberg_graph_edge edges[64];
        size_t nedges = 0;
        if (cberg_graph_edges_from(graph, files[i]->id, CBERG_GEDGE_IMPORTS, edges, 64, &nedges) != CBERG_OK) {
            continue;
        }
        for (size_t e = 0; e < nedges; e++) {
            const cberg_graph_node *mod = cberg_graph_node_by_id(graph, edges[e].dst);
            /* Only rewrite unresolved MODULE targets; already-resolved FILE
             * imports are left alone (idempotent on re-run). */
            if (mod == NULL || mod->kind != CBERG_GNODE_MODULE) {
                continue;
            }
            if (!import_is_resolvable_shape(mod->name, idx.go_module)) {
                continue;
            }
            const char *file = NULL;
            uint64_t mapped = 0;
            if (cberg_strmap_get(idx.import_to_file, mod->name, &mapped)) {
                file = (const char *)(uintptr_t)mapped;
            } else {
                file = find_file_for_import(&idx, mod->name);
            }
            if (file == NULL) {
                continue;
            }
            const cberg_graph_node *targets[8];
            size_t nt = 0;
            if (cberg_graph_find_nodes(graph, NULL, CBERG_GNODE_MASK(CBERG_GNODE_FILE), file, targets, 8, &nt) != CBERG_OK ||
                nt == 0) {
                continue;
            }
            const cberg_graph_node *tgt = NULL;
            for (size_t t = 0; t < nt; t++) {
                if (targets[t]->qname != NULL && strcmp(targets[t]->qname, file) == 0) {
                    tgt = targets[t];
                    break;
                }
            }
            if (tgt == NULL) {
                tgt = targets[0];
            }
            if (tgt->id == edges[e].dst) {
                continue;
            }
            (void)cberg_graph_rewrite_import(graph, files[i]->id, edges[e].dst, tgt->id, file);
        }
    }
    free(files);
    free(idx.file_paths);
    cberg_strmap_free(idx.import_to_file);
    cberg_arena_free(idx.arena);
    return CBERG_OK;
}
