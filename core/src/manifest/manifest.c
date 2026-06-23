/*
 * Content-derived Merkle manifest over one repository's files.
 *
 * Build: walk the tree, hash each file body (XXH3-128) into a leaf, then fold
 * the sorted leaves into a directory tree whose internal nodes roll up their
 * children's (name, hash) pairs via cberg_fingerprint. The root node's hash is
 * the Merkle root.
 *
 * Incremental build: cberg_manifest_rebuild reuses a previous manifest's leaf
 * hash for any file whose size and mtime are unchanged (stat only, no read), so
 * a rebuild reads and hashes only the files that actually changed — the rest are
 * carried over. cberg_manifest_build is the from-scratch case (prev = NULL).
 *
 * Diff: compare two trees top-down, pruning any directory whose rollup hash is
 * unchanged — so a localized edit costs O(changed files + path depth) instead
 * of O(all files). The root-hash equality check is the O(1) "did anything
 * change at all" gate used to skip unchanged repos entirely.
 */
#include "codeberg/codeberg.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "arena.h"
#include "grow.h"
#include "pathutil.h"

/* struct stat carries mtime nanoseconds under different member names. */
#if defined(__APPLE__)
#define CBERG_STAT_MTIME_NS(sb) ((int64_t)(sb).st_mtimespec.tv_sec * 1000000000LL + (int64_t)(sb).st_mtimespec.tv_nsec)
#else
#define CBERG_STAT_MTIME_NS(sb) ((int64_t)(sb).st_mtim.tv_sec * 1000000000LL + (int64_t)(sb).st_mtim.tv_nsec)
#endif

/* A file leaf or a directory node. Directory children are sorted by strcmp on
 * name, which reproduces the order of a path-sorted leaf list (siblings never
 * interleave), so two manifests can be merged child-by-child in lockstep. */
typedef struct manifest_node {
    const char *name; /* basename; "" for the root, arena-owned */
    const char *path; /* full repo-relative path; "" for the root, arena-owned */
    bool is_dir;
    uint8_t hash[CBERG_HASH_LEN];
    struct manifest_node **children; /* arena-owned, sorted by name (dirs only) */
    size_t child_len;
} manifest_node;

/* Stat fingerprint kept parallel to `entries`, used to reuse a leaf hash on
 * rebuild without re-reading the file. */
typedef struct {
    uint64_t size;
    int64_t mtime_ns;
} manifest_meta;

struct cberg_manifest {
    cberg_arena *arena;
    cberg_manifest_entry *entries; /* sorted by path; malloc-owned */
    manifest_meta *meta;           /* parallel to entries; malloc-owned */
    size_t len;
    size_t hashed; /* files actually read+hashed in the build that produced this */
    manifest_node *root;
    uint8_t root_hash[CBERG_HASH_LEN];
};

/* ------------------------------------------------------------------ build */

/* One collected file before the tree is folded. */
typedef struct {
    char *path; /* arena-owned, repo-relative */
    uint8_t hash[CBERG_HASH_LEN];
    manifest_meta meta;
} build_leaf;

typedef struct {
    cberg_arena *arena;
    const cberg_manifest *prev; /* may be NULL: full build */
    build_leaf *leaves;
    size_t len;
    size_t cap;
    size_t hashed;
    cberg_status err;
} build_ctx;

static bool manifest_skip(const char *name, void *ctx) {
    (void)ctx;
    return cberg_watch_skip_dir(name) != 0;
}

/* Binary search `prev` (entries sorted by path) for `path`. */
static bool prev_lookup(const cberg_manifest *prev, const char *path, size_t *out_index) {
    if (prev == NULL) {
        return false;
    }
    size_t lo = 0, hi = prev->len;
    while (lo < hi) {
        size_t mid = lo + (hi - lo) / 2;
        int c = strcmp(prev->entries[mid].path, path);
        if (c == 0) {
            *out_index = mid;
            return true;
        }
        if (c < 0) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return false;
}

static char *read_all(const char *abs, size_t *out_len) {
    FILE *f = fopen(abs, "rb");
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

static cberg_status build_visit(void *vctx, const char *abs, const char *rel, cberg_fs_entry_kind kind) {
    build_ctx *ctx = vctx;
    if (kind != CBERG_FS_FILE) {
        return CBERG_OK;
    }
    struct stat sb;
    if (stat(abs, &sb) != 0) {
        return CBERG_OK; /* vanished between walk and stat: skip */
    }
    manifest_meta meta = {.size = (uint64_t)sb.st_size, .mtime_ns = CBERG_STAT_MTIME_NS(sb)};

    char *path = cberg_arena_strdup(ctx->arena, rel);
    if (path == NULL) {
        ctx->err = CBERG_ERR_OUT_OF_MEMORY;
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    uint8_t hash[CBERG_HASH_LEN];
    size_t pi = 0;
    if (prev_lookup(ctx->prev, rel, &pi) && ctx->prev->meta[pi].size == meta.size &&
        ctx->prev->meta[pi].mtime_ns == meta.mtime_ns) {
        memcpy(hash, ctx->prev->entries[pi].hash, CBERG_HASH_LEN); /* unchanged: reuse, no read */
    } else {
        size_t len = 0;
        char *data = read_all(abs, &len);
        if (data == NULL) {
            return CBERG_OK; /* unreadable: skip leaf, not fatal */
        }
        cberg_status st = cberg_hash(data, len, hash);
        free(data);
        if (st != CBERG_OK) {
            ctx->err = st;
            return st;
        }
        ctx->hashed++;
    }

    if (ctx->len + 1 > ctx->cap) {
        size_t cap = cberg_grow_cap(ctx->cap, ctx->len + 1, 64);
        build_leaf *grown = realloc(ctx->leaves, cap * sizeof(*grown));
        if (grown == NULL) {
            ctx->err = CBERG_ERR_OUT_OF_MEMORY;
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        ctx->leaves = grown;
        ctx->cap = cap;
    }
    build_leaf *bl = &ctx->leaves[ctx->len++];
    bl->path = path;
    bl->meta = meta;
    memcpy(bl->hash, hash, CBERG_HASH_LEN);
    return CBERG_OK;
}

static int compare_leaf_path(const void *a, const void *b) {
    const build_leaf *la = a;
    const build_leaf *lb = b;
    return strcmp(la->path, lb->path);
}

/* End byte offset of the path component of `rel` starting at `from` (up to the
 * next '/' or the string end). Sets *is_dir when a '/' follows. */
static size_t component_end(const char *rel, size_t from, bool *is_dir) {
    size_t i = from;
    while (rel[i] != '\0' && rel[i] != '/') {
        i++;
    }
    *is_dir = rel[i] == '/';
    return i;
}

/*
 * Span of the child run starting at leaf `i`: all leaves sharing the same next
 * path component at offset `prefix`. Returns the exclusive end index; sets
 * *end to the component's end offset and *is_dir to whether it's a directory.
 * Leaves are path-sorted, so a run is contiguous.
 */
static size_t child_run(const cberg_manifest_entry *leaves, size_t i, size_t hi, size_t prefix, size_t *end,
                        bool *is_dir) {
    *end = component_end(leaves[i].path, prefix, is_dir);
    if (!*is_dir) {
        return i + 1; /* file: a run of one */
    }
    size_t clen = *end - prefix;
    size_t j = i + 1;
    while (j < hi) {
        bool jdir = false;
        size_t jend = component_end(leaves[j].path, prefix, &jdir);
        if (!jdir || jend - prefix != clen || strncmp(leaves[j].path + prefix, leaves[i].path + prefix, clen) != 0) {
            break;
        }
        j++;
    }
    return j;
}

/*
 * Builds the subtree for leaves[lo, hi) that share the directory prefix of byte
 * length `prefix`. `name`/`dir_path` are this node's basename and full
 * repo-relative path ("" at the root), already arena-owned.
 */
static manifest_node *build_subtree(cberg_manifest *m, const cberg_manifest_entry *leaves, size_t lo, size_t hi,
                                    size_t prefix, const char *name, const char *dir_path, cberg_status *err) {
    manifest_node *node = cberg_arena_alloc(m->arena, sizeof(manifest_node));
    if (node == NULL) {
        *err = CBERG_ERR_OUT_OF_MEMORY;
        return NULL;
    }
    memset(node, 0, sizeof(*node));
    node->name = name;
    node->path = dir_path;
    node->is_dir = true;

    /* First pass: count immediate children (distinct next components). */
    size_t child_count = 0;
    for (size_t i = lo; i < hi;) {
        size_t end = 0;
        bool is_dir = false;
        i = child_run(leaves, i, hi, prefix, &end, &is_dir);
        child_count++;
    }

    node->children = cberg_arena_alloc(m->arena, child_count * sizeof(manifest_node *));
    if (child_count > 0 && node->children == NULL) {
        *err = CBERG_ERR_OUT_OF_MEMORY;
        return NULL;
    }

    /* Second pass: build each child. */
    size_t out = 0;
    for (size_t i = lo; i < hi;) {
        size_t end = 0;
        bool is_dir = false;
        size_t j = child_run(leaves, i, hi, prefix, &end, &is_dir);
        char *cname = cberg_arena_dup(m->arena, leaves[i].path + prefix, end - prefix);
        char *cpath = cberg_arena_dup(m->arena, leaves[i].path, end);
        if (cname == NULL || cpath == NULL) {
            *err = CBERG_ERR_OUT_OF_MEMORY;
            return NULL;
        }

        if (!is_dir) {
            manifest_node *leaf = cberg_arena_alloc(m->arena, sizeof(manifest_node));
            if (leaf == NULL) {
                *err = CBERG_ERR_OUT_OF_MEMORY;
                return NULL;
            }
            memset(leaf, 0, sizeof(*leaf));
            leaf->name = cname;
            leaf->path = cpath; /* equals leaves[i].path */
            leaf->is_dir = false;
            memcpy(leaf->hash, leaves[i].hash, CBERG_HASH_LEN);
            node->children[out++] = leaf;
        } else {
            manifest_node *child = build_subtree(m, leaves, i, j, end + 1, cname, cpath, err);
            if (child == NULL) {
                return NULL;
            }
            node->children[out++] = child;
        }
        i = j;
    }
    node->child_len = out;

    /* Roll up children (name, hash) pairs into this directory's hash. */
    if (node->child_len == 0) {
        memset(node->hash, 0, CBERG_HASH_LEN);
        return node;
    }
    const char **names = malloc(node->child_len * sizeof(*names));
    const uint8_t **hashes = malloc(node->child_len * sizeof(*hashes));
    if (names == NULL || hashes == NULL) {
        free(names);
        free(hashes);
        *err = CBERG_ERR_OUT_OF_MEMORY;
        return NULL;
    }
    for (size_t k = 0; k < node->child_len; k++) {
        names[k] = node->children[k]->name;
        hashes[k] = node->children[k]->hash;
    }
    cberg_status st = cberg_fingerprint(names, hashes, node->child_len, node->hash);
    free(names);
    free(hashes);
    if (st != CBERG_OK) {
        *err = st;
        return NULL;
    }
    return node;
}

cberg_status cberg_manifest_rebuild(const cberg_manifest *prev, const char *root, cberg_manifest **out_manifest) {
    if (root == NULL || out_manifest == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_manifest = NULL;

    cberg_manifest *m = calloc(1, sizeof(*m));
    if (m == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    m->arena = cberg_arena_new();
    if (m->arena == NULL) {
        free(m);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    build_ctx ctx = {.arena = m->arena, .prev = prev};
    cberg_status st = cberg_fs_walk(root, "", build_visit, &ctx, manifest_skip, NULL);
    if (st != CBERG_OK) {
        free(ctx.leaves);
        cberg_manifest_free(m);
        return ctx.err != CBERG_OK ? ctx.err : st;
    }

    if (ctx.len > 1) {
        qsort(ctx.leaves, ctx.len, sizeof(*ctx.leaves), compare_leaf_path);
    }

    if (ctx.len > 0) {
        m->entries = malloc(ctx.len * sizeof(*m->entries));
        m->meta = malloc(ctx.len * sizeof(*m->meta));
        if (m->entries == NULL || m->meta == NULL) {
            free(ctx.leaves);
            cberg_manifest_free(m);
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        for (size_t i = 0; i < ctx.len; i++) {
            m->entries[i].path = ctx.leaves[i].path;
            memcpy(m->entries[i].hash, ctx.leaves[i].hash, CBERG_HASH_LEN);
            m->meta[i] = ctx.leaves[i].meta;
        }
    }
    m->len = ctx.len;
    m->hashed = ctx.hashed;
    free(ctx.leaves);

    cberg_status berr = CBERG_OK;
    const char *empty = cberg_arena_strdup(m->arena, "");
    if (empty == NULL) {
        cberg_manifest_free(m);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    m->root = build_subtree(m, m->entries, 0, m->len, 0, empty, empty, &berr);
    if (m->root == NULL) {
        cberg_manifest_free(m);
        return berr;
    }
    memcpy(m->root_hash, m->root->hash, CBERG_HASH_LEN);

    *out_manifest = m;
    return CBERG_OK;
}

cberg_status cberg_manifest_build(const char *root, cberg_manifest **out_manifest) {
    return cberg_manifest_rebuild(NULL, root, out_manifest);
}

void cberg_manifest_free(cberg_manifest *manifest) {
    if (manifest == NULL) {
        return;
    }
    free(manifest->entries);
    free(manifest->meta);
    cberg_arena_free(manifest->arena);
    free(manifest);
}

void cberg_manifest_root(const cberg_manifest *manifest, uint8_t out[CBERG_HASH_LEN]) {
    if (manifest == NULL || out == NULL) {
        return;
    }
    memcpy(out, manifest->root_hash, CBERG_HASH_LEN);
}

size_t cberg_manifest_len(const cberg_manifest *manifest) {
    return manifest == NULL ? 0 : manifest->len;
}

size_t cberg_manifest_hashed_count(const cberg_manifest *manifest) {
    return manifest == NULL ? 0 : manifest->hashed;
}

const cberg_manifest_entry *cberg_manifest_at(const cberg_manifest *manifest, size_t index) {
    if (manifest == NULL || index >= manifest->len) {
        return NULL;
    }
    return &manifest->entries[index];
}

/* ------------------------------------------------------------------- diff */

typedef struct {
    const char **items;
    size_t len;
    size_t cap;
} path_list;

static cberg_status path_push(path_list *l, const char *path) {
    size_t cap = cberg_grow_cap(l->cap, l->len + 1, 16);
    if (cap != l->cap) {
        const char **grown = realloc(l->items, cap * sizeof(*grown));
        if (grown == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        l->items = grown;
        l->cap = cap;
    }
    l->items[l->len++] = path;
    return CBERG_OK;
}

/* Push every file under `node` into `out` (used for whole added/deleted subtrees). */
static cberg_status collect_files(const manifest_node *node, path_list *out) {
    if (!node->is_dir) {
        return path_push(out, node->path);
    }
    for (size_t i = 0; i < node->child_len; i++) {
        cberg_status st = collect_files(node->children[i], out);
        if (st != CBERG_OK) {
            return st;
        }
    }
    return CBERG_OK;
}

/* Diff two directory nodes for the same path. Both are dirs. */
static cberg_status diff_node(const manifest_node *a, const manifest_node *b, path_list *added, path_list *modified,
                              path_list *deleted) {
    if (memcmp(a->hash, b->hash, CBERG_HASH_LEN) == 0) {
        return CBERG_OK; /* prune: identical subtree */
    }

    size_t i = 0, j = 0;
    while (i < a->child_len || j < b->child_len) {
        const manifest_node *ca = i < a->child_len ? a->children[i] : NULL;
        const manifest_node *cb = j < b->child_len ? b->children[j] : NULL;
        int cmp = ca == NULL ? 1 : cb == NULL ? -1 : strcmp(ca->name, cb->name);

        cberg_status st = CBERG_OK;
        if (cmp < 0) {
            st = collect_files(ca, deleted); /* only in prev */
            i++;
        } else if (cmp > 0) {
            st = collect_files(cb, added); /* only in next */
            j++;
        } else if (ca->is_dir && cb->is_dir) {
            st = diff_node(ca, cb, added, modified, deleted);
            i++;
            j++;
        } else if (!ca->is_dir && !cb->is_dir) {
            if (memcmp(ca->hash, cb->hash, CBERG_HASH_LEN) != 0) {
                st = path_push(modified, cb->path);
            }
            i++;
            j++;
        } else {
            /* Same name, file ↔ directory: treat as full delete + add. */
            st = collect_files(ca, deleted);
            if (st == CBERG_OK) {
                st = collect_files(cb, added);
            }
            i++;
            j++;
        }
        if (st != CBERG_OK) {
            return st;
        }
    }
    return CBERG_OK;
}

cberg_status cberg_manifest_diff(const cberg_manifest *prev, const cberg_manifest *next,
                                 cberg_manifest_changes *out_changes) {
    if (prev == NULL || next == NULL || out_changes == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    memset(out_changes, 0, sizeof(*out_changes));

    path_list added = {0}, modified = {0}, deleted = {0};
    cberg_status st = diff_node(prev->root, next->root, &added, &modified, &deleted);
    if (st != CBERG_OK) {
        free(added.items);
        free(modified.items);
        free(deleted.items);
        return st;
    }

    out_changes->added = added.items;
    out_changes->added_len = added.len;
    out_changes->modified = modified.items;
    out_changes->modified_len = modified.len;
    out_changes->deleted = deleted.items;
    out_changes->deleted_len = deleted.len;
    return CBERG_OK;
}

void cberg_manifest_diff_free(cberg_manifest_changes *changes) {
    if (changes == NULL) {
        return;
    }
    free((void *)changes->added);
    free((void *)changes->modified);
    free((void *)changes->deleted);
    memset(changes, 0, sizeof(*changes));
}
