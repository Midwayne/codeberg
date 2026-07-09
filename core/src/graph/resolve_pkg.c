/*
 * Phase 2 package-manifest import resolution. Scans go.mod / package.json /
 * tsconfig paths / pyproject / Cargo.toml under a repo root and rewrites
 * IMPORTS edges whose module string maps to a repo-relative source file so
 * they target that FILE node with resolution=import.
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

/* Map "pkg/foo" or "./foo" style imports onto the first matching source file. */
static const char *find_file_for_import(pkg_index *idx, const char *imp) {
    if (imp == NULL || imp[0] == '\0') {
        return NULL;
    }
    /* Strip leading ./ */
    const char *needle = imp;
    while (needle[0] == '.' && (needle[1] == '/' || needle[1] == '\\')) {
        needle += 2;
    }
    size_t nlen = strlen(needle);
    for (size_t i = 0; i < idx->file_len; i++) {
        const char *p = idx->file_paths[i];
        /* Exact path match without extension, or path prefix. */
        const char *dot = strrchr(p, '.');
        size_t plen = dot != NULL ? (size_t)(dot - p) : strlen(p);
        if (plen == nlen && strncmp(p, needle, nlen) == 0) {
            return p;
        }
        /* Suffix: ".../needle.ext" or "needle/mod.go" for Go packages. */
        if (plen > nlen && p[plen - nlen - 1] == '/' && strncmp(p + plen - nlen, needle, nlen) == 0) {
            return p;
        }
        /* Directory package: needle/xxx.ext */
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
    const char *k = cberg_arena_strdup(idx->arena, key);
    const char *v = cberg_arena_strdup(idx->arena, file);
    if (k != NULL && v != NULL) {
        (void)cberg_strmap_set(idx->import_to_file, k, (uint64_t)(uintptr_t)v);
    }
}

static void scan_go_mod(pkg_index *idx, const char *root) {
    char path[4096];
    snprintf(path, sizeof path, "%s/go.mod", root);
    size_t len = 0;
    char *body = cberg_read_file(path, &len);
    if (body == NULL) {
        return;
    }
    /* module <path> — map module/subdir imports onto local files. */
    const char *p = body;
    char module[512] = {0};
    if (strncmp(p, "module ", 7) == 0) {
        p += 7;
        size_t i = 0;
        while (*p && *p != '\n' && *p != '\r' && i + 1 < sizeof module) {
            module[i++] = *p++;
        }
        module[i] = '\0';
    }
    free(body);
    if (module[0] == '\0') {
        return;
    }
    size_t mlen = strlen(module);
    for (size_t i = 0; i < idx->file_len; i++) {
        const char *rel = idx->file_paths[i];
        if (strstr(rel, ".go") == NULL) {
            continue;
        }
        /* Map module + "/" + dir(rel) → file */
        char key[1024];
        const char *slash = strrchr(rel, '/');
        if (slash != NULL) {
            size_t dlen = (size_t)(slash - rel);
            if (mlen + 1 + dlen + 1 < sizeof key) {
                memcpy(key, module, mlen);
                key[mlen] = '/';
                memcpy(key + mlen + 1, rel, dlen);
                key[mlen + 1 + dlen] = '\0';
                map_put(idx, key, rel);
            }
        } else {
            map_put(idx, module, rel);
        }
    }
}

static void scan_json_deps(pkg_index *idx, const char *root, const char *rel_manifest) {
    char path[4096];
    snprintf(path, sizeof path, "%s/%s", root, rel_manifest);
    size_t len = 0;
    char *body = cberg_read_file(path, &len);
    if (body == NULL) {
        return;
    }
    /* Lightweight: look for "name": "pkg" near the top for package.json. */
    const char *name_key = strstr(body, "\"name\"");
    if (name_key != NULL) {
        const char *q1 = strchr(name_key + 6, '"');
        if (q1 != NULL) {
            q1++;
            const char *q2 = strchr(q1, '"');
            if (q2 != NULL && (size_t)(q2 - q1) < 256) {
                char pkg[256];
                memcpy(pkg, q1, (size_t)(q2 - q1));
                pkg[q2 - q1] = '\0';
                /* Map package name and relative imports under src/ or . */
                for (size_t i = 0; i < idx->file_len; i++) {
                    const char *rel = idx->file_paths[i];
                    if (strstr(rel, ".ts") == NULL && strstr(rel, ".js") == NULL) {
                        continue;
                    }
                    map_put(idx, pkg, rel);
                    break;
                }
            }
        }
    }
    /* Relative import paths: map every source file under its path-without-ext. */
    for (size_t i = 0; i < idx->file_len; i++) {
        const char *rel = idx->file_paths[i];
        const char *dot = strrchr(rel, '.');
        if (dot == NULL) {
            continue;
        }
        char key[512];
        size_t klen = (size_t)(dot - rel);
        if (klen + 1 >= sizeof key) {
            continue;
        }
        memcpy(key, rel, klen);
        key[klen] = '\0';
        map_put(idx, key, rel);
        /* Also "./key" form */
        char dotted[520];
        snprintf(dotted, sizeof dotted, "./%s", key);
        map_put(idx, dotted, rel);
    }
    free(body);
}

static void scan_pyproject(pkg_index *idx, const char *root) {
    char path[4096];
    snprintf(path, sizeof path, "%s/pyproject.toml", root);
    size_t len = 0;
    char *body = cberg_read_file(path, &len);
    if (body == NULL) {
        /* Still map python files by module path. */
    } else {
        free(body);
    }
    for (size_t i = 0; i < idx->file_len; i++) {
        const char *rel = idx->file_paths[i];
        if (strstr(rel, ".py") == NULL) {
            continue;
        }
        char key[512];
        size_t klen = strlen(rel);
        if (klen > 3 && strcmp(rel + klen - 3, ".py") == 0) {
            klen -= 3;
        }
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
        /* Drop __init__ */
        size_t kl = strlen(key);
        if (kl >= 9 && strcmp(key + kl - 9, ".__init__") == 0) {
            key[kl - 9] = '\0';
        }
        map_put(idx, key, rel);
    }
}

static void scan_cargo(pkg_index *idx, const char *root) {
    char path[4096];
    snprintf(path, sizeof path, "%s/Cargo.toml", root);
    size_t len = 0;
    char *body = cberg_read_file(path, &len);
    char crate[256] = {0};
    if (body != NULL) {
        const char *n = strstr(body, "name");
        if (n != NULL) {
            const char *q1 = strchr(n, '"');
            if (q1 == NULL) {
                q1 = strchr(n, '\'');
            }
            if (q1 != NULL) {
                q1++;
                const char *q2 = strchr(q1, * (q1 - 1) == '"' ? '"' : '\'');
                if (q2 != NULL && (size_t)(q2 - q1) < sizeof crate) {
                    memcpy(crate, q1, (size_t)(q2 - q1));
                    crate[q2 - q1] = '\0';
                }
            }
        }
        free(body);
    }
    for (size_t i = 0; i < idx->file_len; i++) {
        const char *rel = idx->file_paths[i];
        if (strstr(rel, ".rs") == NULL) {
            continue;
        }
        if (crate[0] != '\0') {
            map_put(idx, crate, rel);
            char key[512];
            snprintf(key, sizeof key, "crate::%s", crate);
            map_put(idx, key, rel);
        }
        /* Relative module path without .rs */
        const char *dot = strrchr(rel, '.');
        if (dot != NULL) {
            char key[512];
            size_t klen = (size_t)(dot - rel);
            if (klen + 1 < sizeof key) {
                memcpy(key, rel, klen);
                key[klen] = '\0';
                map_put(idx, key, rel);
            }
        }
    }
}

/* Forward decls of store internals we need — resolve_imports lives beside the
 * store and uses the public ABI only for queries, then mutates via a small
 * internal helper declared here. */
cberg_status cberg_graph_rewrite_import(cberg_graph *graph, uint64_t src_file_id, uint64_t old_dst, uint64_t new_dst, const char *new_name);

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

    /* Also map relative imports via find_file_for_import for anything not in map. */
    const cberg_graph_node *files[4096];
    size_t nfiles = 0;
    cberg_status st = cberg_graph_find_nodes(graph, NULL, CBERG_GNODE_MASK(CBERG_GNODE_FILE), NULL, files, 4096, &nfiles);
    if (st != CBERG_OK) {
        goto done;
    }
    for (size_t i = 0; i < nfiles; i++) {
        cberg_graph_edge edges[64];
        size_t nedges = 0;
        if (cberg_graph_edges_from(graph, files[i]->id, CBERG_GEDGE_IMPORTS, edges, 64, &nedges) != CBERG_OK) {
            continue;
        }
        for (size_t e = 0; e < nedges; e++) {
            const cberg_graph_node *mod = cberg_graph_node_by_id(graph, edges[e].dst);
            if (mod == NULL || mod->kind != CBERG_GNODE_MODULE) {
                continue;
            }
            uint64_t mapped = 0;
            const char *file = NULL;
            if (cberg_strmap_get(idx.import_to_file, mod->name, &mapped)) {
                file = (const char *)(uintptr_t)mapped;
            } else {
                file = find_file_for_import(&idx, mod->name);
            }
            if (file == NULL) {
                continue;
            }
            /* Find FILE node for that path. */
            const cberg_graph_node *targets[4];
            size_t nt = 0;
            if (cberg_graph_find_nodes(graph, NULL, CBERG_GNODE_MASK(CBERG_GNODE_FILE), file, targets, 4, &nt) != CBERG_OK ||
                nt == 0) {
                continue;
            }
            /* Prefer exact path match. */
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
    st = CBERG_OK;

done:
    free(idx.file_paths);
    cberg_strmap_free(idx.import_to_file);
    cberg_arena_free(idx.arena);
    return st;
}
