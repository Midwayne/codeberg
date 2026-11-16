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
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include "arena.h"
#include "fileio.h"
#include "grow.h"
#include "manifest_internal.h"
#include "pathutil.h"
#include "statutil.h"
#include "walk_policy.h"

typedef struct {
    uint8_t hash[CBERG_HASH_LEN];
    manifest_meta meta;
    char *path; /* arena-owned, repo-relative */
} build_leaf;

typedef struct {
    cberg_arena *arena;
    const cberg_manifest *prev; /* may be NULL: full build */
    build_leaf *leaves;
    size_t len;
    size_t cap;
    size_t hashed;
    cberg_status err;
    const char **fp_names;
    const uint8_t **fp_hashes;
    size_t fp_cap;
} build_ctx;

static void build_ctx_free(build_ctx *ctx) {
    free(ctx->leaves);
    free(ctx->fp_names);
    free(ctx->fp_hashes);
}

cberg_manifest *manifest_new(void) {
    cberg_manifest *m = calloc(1, sizeof(*m));
    if (m == NULL) {
        return NULL;
    }

    m->arena = cberg_arena_new();
    if (m->arena == NULL) {
        free(m);
        return NULL;
    }
    return m;
}

/* ------------------------------------------------------------- file walk */

static bool prev_lookup(const cberg_manifest *prev, const char *path, size_t *out_index) {
    if (prev == NULL) {
        return false;
    }

    size_t lo = 0;
    size_t hi = prev->len;
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

/* Fills hash with the file's body hash, reusing the previous manifest's when
 * size and mtime are unchanged. Returns CBERG_ERR_NOT_FOUND when the file
 * cannot be read, which skips it. */
static cberg_status leaf_hash(build_ctx *ctx, const char *abs, const char *rel, manifest_meta meta, uint8_t hash[CBERG_HASH_LEN]) {
    size_t pi = 0;
    if (prev_lookup(ctx->prev, rel, &pi) && ctx->prev->meta[pi].size == meta.size && ctx->prev->meta[pi].mtime_ns == meta.mtime_ns) {
        memcpy(hash, ctx->prev->entries[pi].hash, CBERG_HASH_LEN);
        return CBERG_OK;
    }

    size_t len = 0;
    char *data = cberg_read_file(abs, &len);
    if (data == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }

    cberg_status st = cberg_hash(data, len, hash);
    free(data);
    if (st == CBERG_OK) {
        ctx->hashed++;
    }
    return st;
}

static cberg_status leaves_push(build_ctx *ctx, char *path, manifest_meta meta, const uint8_t hash[CBERG_HASH_LEN]) {
    if (ctx->len + 1 > ctx->cap) {
        size_t cap = cberg_grow_cap(ctx->cap, ctx->len + 1, 64);
        build_leaf *grown = realloc(ctx->leaves, cap * sizeof(*grown));
        if (grown == NULL) {
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

/* Walk callback: records one leaf per readable file. Files that vanish or
 * cannot be read are skipped; only hashing and memory failures stop the walk. */
static cberg_status build_visit(void *vctx, const char *abs, const char *rel, cberg_fs_entry_kind kind) {
    build_ctx *ctx = vctx;
    if (kind != CBERG_FS_FILE) {
        return CBERG_OK;
    }

    struct stat sb;
    if (stat(abs, &sb) != 0) {
        return CBERG_OK;
    }
    manifest_meta meta = {.size = (uint64_t)sb.st_size, .mtime_ns = CBERG_STAT_MTIME_NS(sb)};

    char *path = cberg_arena_strdup(ctx->arena, rel);
    if (path == NULL) {
        ctx->err = CBERG_ERR_OUT_OF_MEMORY;
        return ctx->err;
    }

    uint8_t hash[CBERG_HASH_LEN];
    cberg_status st = leaf_hash(ctx, abs, rel, meta, hash);
    if (st == CBERG_ERR_NOT_FOUND) {
        return CBERG_OK;
    }

    if (st == CBERG_OK) {
        st = leaves_push(ctx, path, meta, hash);
    }
    if (st != CBERG_OK) {
        ctx->err = st;
    }
    return st;
}

/* ------------------------------------------------------------ tree build */

static int compare_leaf_path(const void *a, const void *b) {
    const build_leaf *la = a;
    const build_leaf *lb = b;
    return strcmp(la->path, lb->path);
}

static size_t component_end(const char *rel, size_t from, bool *is_dir) {
    size_t i = from;
    while (rel[i] != '\0' && rel[i] != '/') {
        i++;
    }
    *is_dir = rel[i] == '/';
    return i;
}

static size_t child_run(const cberg_manifest_entry *leaves, size_t i, size_t hi, size_t prefix, size_t *end, bool *is_dir) {
    *end = component_end(leaves[i].path, prefix, is_dir);
    if (!*is_dir) {
        return i + 1;
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

static cberg_status fp_scratch_grow(build_ctx *ctx, size_t need) {
    if (need <= ctx->fp_cap) {
        return CBERG_OK;
    }
    size_t cap = cberg_grow_cap(ctx->fp_cap, need, 16);
    const char **names = realloc(ctx->fp_names, cap * sizeof(*names));
    const uint8_t **hashes = realloc(ctx->fp_hashes, cap * sizeof(*hashes));
    if (names == NULL || hashes == NULL) {
        free(names);
        free(hashes);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    ctx->fp_names = names;
    ctx->fp_hashes = hashes;
    ctx->fp_cap = cap;
    return CBERG_OK;
}

static cberg_status rollup_children(build_ctx *ctx, const cberg_manifest *m, const manifest_node *node, uint8_t out[CBERG_HASH_LEN]) {
    if (node->child_len == 0) {
        memset(out, 0, CBERG_HASH_LEN);
        return CBERG_OK;
    }
    cberg_status st = fp_scratch_grow(ctx, node->child_len);
    if (st != CBERG_OK) {
        return st;
    }
    for (size_t k = 0; k < node->child_len; k++) {
        const manifest_child *ch = &node->children[k];
        ctx->fp_names[k] = ch->name;
        if (ch->is_dir) {
            ctx->fp_hashes[k] = ch->u.dir->hash;
        } else {
            ctx->fp_hashes[k] = m->entries[ch->u.leaf_index].hash;
        }
    }
    return cberg_fingerprint(ctx->fp_names, ctx->fp_hashes, node->child_len, out);
}

static size_t count_children(const cberg_manifest_entry *leaves, size_t lo, size_t hi, size_t prefix) {
    size_t count = 0;
    for (size_t i = lo; i < hi; count++) {
        size_t end = 0;
        bool is_dir = false;
        i = child_run(leaves, i, hi, prefix, &end, &is_dir);
    }
    return count;
}

static manifest_node *build_subtree(build_ctx *ctx, cberg_manifest *m, const cberg_manifest_entry *leaves, size_t lo, size_t hi, size_t prefix, const char *name, const char *dir_path, cberg_status *err);

/* Fills one child: a file leaf, or a subdirectory built recursively from the
 * leaves [i, j) that share its path component. */
static cberg_status fill_child(build_ctx *ctx, cberg_manifest *m, const cberg_manifest_entry *leaves, size_t i, size_t j, size_t prefix, size_t end, bool is_dir, manifest_child *ch) {
    char *cname = cberg_arena_dup(m->arena, leaves[i].path + prefix, end - prefix);
    if (cname == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    ch->name = cname;
    ch->is_dir = is_dir;
    if (!is_dir) {
        ch->u.leaf_index = (uint32_t)i;
        return CBERG_OK;
    }

    char *cpath = cberg_arena_dup(m->arena, leaves[i].path, end);
    if (cpath == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = CBERG_OK;
    ch->u.dir = build_subtree(ctx, m, leaves, i, j, end + 1, cname, cpath, &st);
    return st;
}

/* Builds the directory node for leaves [lo, hi), whose paths share the first
 * prefix bytes. Returns NULL and sets *err on failure. */
static manifest_node *build_subtree(build_ctx *ctx, cberg_manifest *m, const cberg_manifest_entry *leaves, size_t lo, size_t hi, size_t prefix, const char *name, const char *dir_path, cberg_status *err) {
    manifest_node *node = cberg_arena_alloc(m->arena, sizeof(manifest_node));
    size_t child_count = count_children(leaves, lo, hi, prefix);
    if (node != NULL) {
        memset(node, 0, sizeof(*node));
        node->children = cberg_arena_alloc(m->arena, child_count * sizeof(manifest_child));
    }
    if (node == NULL || (child_count > 0 && node->children == NULL)) {
        *err = CBERG_ERR_OUT_OF_MEMORY;
        return NULL;
    }
    node->name = name;
    node->path = dir_path;

    for (size_t i = lo; i < hi;) {
        size_t end = 0;
        bool is_dir = false;
        size_t j = child_run(leaves, i, hi, prefix, &end, &is_dir);

        cberg_status st = fill_child(ctx, m, leaves, i, j, prefix, end, is_dir, &node->children[node->child_len++]);
        if (st != CBERG_OK) {
            *err = st;
            return NULL;
        }
        i = j;
    }

    cberg_status st = rollup_children(ctx, m, node, node->hash);
    if (st != CBERG_OK) {
        *err = st;
        return NULL;
    }
    return node;
}

cberg_status manifest_build_tree(cberg_manifest *m) {
    const char *empty = cberg_arena_strdup(m->arena, "");
    if (empty == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    build_ctx ctx = {0};
    cberg_status err = CBERG_OK;
    m->root = build_subtree(&ctx, m, m->entries, 0, m->len, 0, empty, empty, &err);
    build_ctx_free(&ctx);
    if (m->root == NULL) {
        return err;
    }

    memcpy(m->root_hash, m->root->hash, CBERG_HASH_LEN);
    return CBERG_OK;
}

/* Moves the walked leaves, sorted by path, into m's entries and meta. */
static cberg_status adopt_leaves(cberg_manifest *m, build_ctx *ctx) {
    if (ctx->len > 1) {
        qsort(ctx->leaves, ctx->len, sizeof(*ctx->leaves), compare_leaf_path);
    }

    if (ctx->len > 0) {
        m->entries = malloc(ctx->len * sizeof(*m->entries));
        m->meta = malloc(ctx->len * sizeof(*m->meta));
        if (m->entries == NULL || m->meta == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }

    for (size_t i = 0; i < ctx->len; i++) {
        m->entries[i].path = ctx->leaves[i].path;
        memcpy(m->entries[i].hash, ctx->leaves[i].hash, CBERG_HASH_LEN);
        m->meta[i] = ctx->leaves[i].meta;
    }
    m->len = ctx->len;
    m->hashed = ctx->hashed;
    return CBERG_OK;
}

cberg_status cberg_manifest_rebuild(const cberg_manifest *prev, const char *root, cberg_manifest **out_manifest) {
    if (root == NULL || out_manifest == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_manifest = NULL;

    cberg_manifest *m = manifest_new();
    if (m == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    build_ctx ctx = {.arena = m->arena, .prev = prev};
    cberg_status st = cberg_fs_walk(root, "", build_visit, &ctx, cberg_walk_skip_dir_cb, NULL);
    if (st != CBERG_OK && ctx.err != CBERG_OK) {
        st = ctx.err;
    }

    if (st == CBERG_OK) {
        st = adopt_leaves(m, &ctx);
    }
    build_ctx_free(&ctx);

    if (st == CBERG_OK) {
        st = manifest_build_tree(m);
    }
    if (st != CBERG_OK) {
        cberg_manifest_free(m);
        return st;
    }

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
