/*
 * Phase 2 import resolution. Using the repository's import index (source files
 * and go.mod module path, built in import_index.c), rewrites IMPORTS edges whose
 * module string maps to a repo-relative source file so they target that FILE
 * node with resolution=import.
 *
 * Safety: bare identifiers (fmt, json, os) and slash-form stdlib/npm packages
 * (encoding/json) are never rewritten — only relative imports (./, ../), Rust
 * `::` paths, Go module-prefixed paths, multi-segment dotted names, or
 * source-file paths (such as dir/file.h) are candidates. Package names from manifests are
 * never mapped onto arbitrary first files.
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

static int import_is_relative(const char *imp) {
    return imp[0] == '.' && (imp[1] == '/' || imp[1] == '\\' ||
                             (imp[1] == '.' && (imp[2] == '/' || imp[2] == '\\')));
}

/* Path-like imports that look like source files (C includes, explicit paths). */
static int import_has_source_ext(const char *imp) {
    const char *slash = strrchr(imp, '/');
    const char *bslash = strrchr(imp, '\\');
    const char *base = imp;
    if (slash != NULL && slash + 1 > base) {
        base = slash + 1;
    }
    if (bslash != NULL && bslash + 1 > base) {
        base = bslash + 1;
    }
    if (graph_is_code_source(base)) {
        return 1;
    }
    /* Extra C++ headers not in cberg_language_from_path. */
    const char *dot = strrchr(base, '.');
    return dot != NULL && (strcmp(dot, ".hpp") == 0 || strcmp(dot, ".hh") == 0);
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

/* Map relative / path-like imports onto a unique matching source file.
 * Ambiguous matches (multiple distinct paths) return NULL so the edge stays
 * MODULE rather than picking an arbitrary first walk hit at high confidence. */
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
    const char *found = NULL;
    for (size_t i = 0; i < idx->file_len; i++) {
        const char *p = idx->file_paths[i];
        const char *dot = strrchr(p, '.');
        size_t plen = dot != NULL ? (size_t)(dot - p) : strlen(p);
        int match = 0;
        if (plen == nlen && strncmp(p, needle, nlen) == 0) {
            match = 1;
        } else if (plen > nlen && p[plen - nlen - 1] == '/' && strncmp(p + plen - nlen, needle, nlen) == 0) {
            match = 1;
        } else if (strncmp(p, needle, nlen) == 0 && p[nlen] == '/') {
            /* Directory package: needle/xxx.ext (Go packages, Python packages). */
            match = 1;
        }
        if (!match) {
            continue;
        }
        if (found != NULL && strcmp(found, p) != 0) {
            return NULL; /* ambiguous */
        }
        found = p;
    }
    return found;
}

/* Collects the ids of every FILE node. Ids, not node pointers: rewriting an
 * import may compact and free graph->nodes. *out_ids is caller-freed. */
static cberg_status collect_file_ids(cberg_graph *graph, size_t node_count, uint64_t **out_ids, size_t *out_len) {
    const cberg_graph_node **files = calloc(node_count, sizeof(*files));
    uint64_t *ids = calloc(node_count, sizeof(*ids));
    if (files == NULL || ids == NULL) {
        free(files);
        free(ids);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    size_t nfiles = 0;
    cberg_status st = cberg_graph_find_nodes(graph, NULL, CBERG_GNODE_MASK(CBERG_GNODE_FILE), NULL, files, node_count, &nfiles);
    for (size_t i = 0; st == CBERG_OK && i < nfiles; i++) {
        ids[i] = files[i]->id;
    }
    free(files);

    if (st != CBERG_OK) {
        free(ids);
        return st;
    }

    *out_ids = ids;
    *out_len = nfiles;
    return CBERG_OK;
}

/* The repo path an import from file_id points at, or NULL when unknown. */
static const char *import_target_path(cberg_graph *graph, pkg_index *idx, uint64_t file_id, const char *imp) {
    if (import_is_relative(imp)) {
        const cberg_graph_node *source = cberg_graph_node_by_id(graph, file_id);
        return source != NULL ? cberg_graph_relative_file(source->path, imp, idx->file_paths, idx->file_len) : NULL;
    }

    uint64_t mapped = 0;
    if (cberg_strmap_get(idx->import_to_file, imp, &mapped)) {
        return (const char *)(uintptr_t)mapped;
    }

    return find_file_for_import(idx, imp);
}

/* The FILE node for path: the exact qname match, else the first candidate;
 * 0 when there is none. Looked up afresh each time since compaction may
 * have moved nodes. */
static uint64_t file_node_id(cberg_graph *graph, const char *path) {
    const cberg_graph_node *targets[8];
    size_t nt = 0;
    if (cberg_graph_find_nodes(graph, NULL, CBERG_GNODE_MASK(CBERG_GNODE_FILE), path, targets, 8, &nt) != CBERG_OK || nt == 0) {
        return 0;
    }

    for (size_t t = 0; t < nt; t++) {
        if (targets[t]->qname != NULL && strcmp(targets[t]->qname, path) == 0) {
            return targets[t]->id;
        }
    }
    return targets[0]->id;
}

/* Rewrites file_id's unresolved MODULE imports to the FILE nodes they name.
 * Already-resolved FILE imports are left alone, so re-runs are idempotent. */
static void resolve_file_imports(cberg_graph *graph, pkg_index *idx, uint64_t file_id, cberg_graph_edge *edges, size_t edges_cap) {
    size_t nedges = 0;
    if (cberg_graph_edges_from(graph, file_id, CBERG_GEDGE_IMPORTS, edges, edges_cap, &nedges) != CBERG_OK) {
        return;
    }

    for (size_t e = 0; e < nedges; e++) {
        const cberg_graph_node *mod = cberg_graph_node_by_id(graph, edges[e].dst);
        if (mod == NULL || mod->kind != CBERG_GNODE_MODULE || !import_is_resolvable_shape(mod->name, idx->go_module)) {
            continue;
        }

        const char *file = import_target_path(graph, idx, file_id, mod->name);
        uint64_t target = file != NULL ? file_node_id(graph, file) : 0;
        if (target != 0 && target != edges[e].dst) {
            (void)cberg_graph_rewrite_import(graph, file_id, edges[e].dst, target, file);
        }
    }
}

static cberg_status resolve_with_cache(cberg_graph *graph, pkg_index *idx) {
    size_t node_count = 0;
    size_t refs_cap = 0;
    cberg_graph_counts(graph, &node_count, &refs_cap);
    if (node_count == 0) {
        return CBERG_OK;
    }

    uint64_t *file_ids = NULL;
    size_t nfiles = 0;
    cberg_status st = collect_file_ids(graph, node_count, &file_ids, &nfiles);
    if (st != CBERG_OK) {
        return st;
    }

    /* Cap must cover every IMPORTS ref — a fixed 64-slot buffer silently left
     * the rest as MODULE forever. Size once from live ref count. */
    if (refs_cap < 64) {
        refs_cap = 64;
    }
    cberg_graph_edge *edges = calloc(refs_cap, sizeof(*edges));
    if (edges == NULL) {
        free(file_ids);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    for (size_t i = 0; i < nfiles; i++) {
        resolve_file_imports(graph, idx, file_ids[i], edges, refs_cap);
    }

    free(edges);
    free(file_ids);
    return CBERG_OK;
}

cberg_status cberg_graph_resolve_cached(cberg_graph *graph, const char *root, cberg_import_cache **cache) {
    return cberg_graph_resolve_cached_ex(graph, root, NULL, cache);
}

cberg_status cberg_graph_resolve_cached_ex(cberg_graph *graph, const char *root, const cberg_exclusions *exclusions, cberg_import_cache **cache) {
    if (graph == NULL || root == NULL || cache == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (*cache == NULL) {
        cberg_status reset = cberg_graph_reset_imports(graph);
        if (reset != CBERG_OK)
            return reset;

        cberg_status st = graph_import_index_build(root, exclusions, cache);
        if (st != CBERG_OK) {
            return st;
        }
    }
    return resolve_with_cache(graph, *cache);
}

cberg_status cberg_graph_resolve_imports(cberg_graph *graph, const char *repo_root) {
    cberg_import_cache *cache = NULL;
    cberg_status st = cberg_graph_resolve_cached(graph, repo_root, &cache);
    cberg_import_cache_free(cache);
    return st;
}
