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
#include "fileio.h"
#include "grow.h"
#include "pathutil.h"
#include "statutil.h"
#include "walk_policy.h"

struct manifest_node;

/* One child of a directory node: either a file (index into entries[]) or a subdirectory. */
typedef struct manifest_child {
    const char *name; /* basename, arena-owned */
    bool is_dir;
    uint32_t leaf_index;       /* when !is_dir */
    struct manifest_node *dir; /* when is_dir */
} manifest_child;

/* Directory-only tree node; file leaves live only in entries[]. */
typedef struct manifest_node {
    const char *name; /* basename; "" for the root, arena-owned */
    const char *path; /* full repo-relative path; "" for the root, arena-owned */
    uint8_t hash[CBERG_HASH_LEN];
    manifest_child *children; /* arena-owned, sorted by name */
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
    const char **fp_names;
    const uint8_t **fp_hashes;
    size_t fp_cap;
} build_ctx;

static bool walk_skip(const char *name, void *ctx) {
    (void)ctx;
    return cberg_walk_skip_dir(name) != 0;
}

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
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    uint8_t hash[CBERG_HASH_LEN];
    size_t pi = 0;
    if (prev_lookup(ctx->prev, rel, &pi) && ctx->prev->meta[pi].size == meta.size &&
        ctx->prev->meta[pi].mtime_ns == meta.mtime_ns) {
        memcpy(hash, ctx->prev->entries[pi].hash, CBERG_HASH_LEN);
    } else {
        size_t len = 0;
        char *data = cberg_read_file(abs, &len);
        if (data == NULL) {
            return CBERG_OK;
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

static size_t component_end(const char *rel, size_t from, bool *is_dir) {
    size_t i = from;
    while (rel[i] != '\0' && rel[i] != '/') {
        i++;
    }
    *is_dir = rel[i] == '/';
    return i;
}

static size_t child_run(const cberg_manifest_entry *leaves, size_t i, size_t hi, size_t prefix, size_t *end,
                        bool *is_dir) {
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

static cberg_status rollup_children(build_ctx *ctx, const cberg_manifest *m, const manifest_node *node,
                                    uint8_t out[CBERG_HASH_LEN]) {
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
            ctx->fp_hashes[k] = ch->dir->hash;
        } else {
            ctx->fp_hashes[k] = m->entries[ch->leaf_index].hash;
        }
    }
    return cberg_fingerprint(ctx->fp_names, ctx->fp_hashes, node->child_len, out);
}

static manifest_node *build_subtree(build_ctx *ctx, cberg_manifest *m, const cberg_manifest_entry *leaves, size_t lo,
                                    size_t hi, size_t prefix, const char *name, const char *dir_path,
                                    cberg_status *err) {
    manifest_node *node = cberg_arena_alloc(m->arena, sizeof(manifest_node));
    if (node == NULL) {
        *err = CBERG_ERR_OUT_OF_MEMORY;
        return NULL;
    }
    memset(node, 0, sizeof(*node));
    node->name = name;
    node->path = dir_path;

    size_t child_count = 0;
    for (size_t i = lo; i < hi;) {
        size_t end = 0;
        bool is_dir = false;
        i = child_run(leaves, i, hi, prefix, &end, &is_dir);
        child_count++;
    }

    node->children = cberg_arena_alloc(m->arena, child_count * sizeof(manifest_child));
    if (child_count > 0 && node->children == NULL) {
        *err = CBERG_ERR_OUT_OF_MEMORY;
        return NULL;
    }

    size_t out = 0;
    for (size_t i = lo; i < hi;) {
        size_t end = 0;
        bool is_dir = false;
        size_t j = child_run(leaves, i, hi, prefix, &end, &is_dir);
        char *cname = cberg_arena_dup(m->arena, leaves[i].path + prefix, end - prefix);
        if (cname == NULL) {
            *err = CBERG_ERR_OUT_OF_MEMORY;
            return NULL;
        }

        manifest_child *ch = &node->children[out++];
        ch->name = cname;
        ch->is_dir = is_dir;

        if (!is_dir) {
            ch->leaf_index = (uint32_t)i;
        } else {
            char *cpath = cberg_arena_dup(m->arena, leaves[i].path, end);
            if (cpath == NULL) {
                *err = CBERG_ERR_OUT_OF_MEMORY;
                return NULL;
            }
            ch->dir = build_subtree(ctx, m, leaves, i, j, end + 1, cname, cpath, err);
            if (ch->dir == NULL) {
                return NULL;
            }
        }
        i = j;
    }
    node->child_len = out;

    cberg_status st = rollup_children(ctx, m, node, node->hash);
    if (st != CBERG_OK) {
        *err = st;
        return NULL;
    }
    return node;
}

/* Build the directory tree (and root hash) from m->entries, which must already
 * be populated and sorted by path. Shared by a fresh build and a load from disk;
 * uses only the stored leaf hashes, so it reads no files. */
static cberg_status manifest_build_tree(cberg_manifest *m) {
    build_ctx ctx = {0};
    const char *empty = cberg_arena_strdup(m->arena, "");
    if (empty == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    cberg_status err = CBERG_OK;
    m->root = build_subtree(&ctx, m, m->entries, 0, m->len, 0, empty, empty, &err);
    free(ctx.fp_names);
    free(ctx.fp_hashes);
    if (m->root == NULL) {
        return err;
    }
    memcpy(m->root_hash, m->root->hash, CBERG_HASH_LEN);
    return CBERG_OK;
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
    cberg_status st = cberg_fs_walk(root, "", build_visit, &ctx, walk_skip, NULL);
    if (st != CBERG_OK) {
        free(ctx.leaves);
        free(ctx.fp_names);
        free(ctx.fp_hashes);
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
            free(ctx.fp_names);
            free(ctx.fp_hashes);
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

    cberg_status berr = manifest_build_tree(m);
    if (berr != CBERG_OK) {
        cberg_manifest_free(m);
        return berr;
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

static cberg_status collect_files(const cberg_manifest *m, const manifest_node *node, path_list *out) {
    for (size_t i = 0; i < node->child_len; i++) {
        const manifest_child *ch = &node->children[i];
        cberg_status st;
        if (ch->is_dir) {
            st = collect_files(m, ch->dir, out);
        } else {
            st = path_push(out, m->entries[ch->leaf_index].path);
        }
        if (st != CBERG_OK) {
            return st;
        }
    }
    return CBERG_OK;
}

static cberg_status diff_node(const cberg_manifest *prev_m, const manifest_node *a, const cberg_manifest *next_m,
                              const manifest_node *b, path_list *added, path_list *modified, path_list *deleted) {
    if (memcmp(a->hash, b->hash, CBERG_HASH_LEN) == 0) {
        return CBERG_OK;
    }

    size_t i = 0, j = 0;
    while (i < a->child_len || j < b->child_len) {
        const manifest_child *ca = i < a->child_len ? &a->children[i] : NULL;
        const manifest_child *cb = j < b->child_len ? &b->children[j] : NULL;
        int cmp = ca == NULL ? 1 : cb == NULL ? -1 : strcmp(ca->name, cb->name);

        cberg_status st = CBERG_OK;
        if (cmp < 0) {
            if (ca->is_dir) {
                st = collect_files(prev_m, ca->dir, deleted);
            } else {
                st = path_push(deleted, prev_m->entries[ca->leaf_index].path);
            }
            i++;
        } else if (cmp > 0) {
            if (cb->is_dir) {
                st = collect_files(next_m, cb->dir, added);
            } else {
                st = path_push(added, next_m->entries[cb->leaf_index].path);
            }
            j++;
        } else if (ca->is_dir && cb->is_dir) {
            st = diff_node(prev_m, ca->dir, next_m, cb->dir, added, modified, deleted);
            i++;
            j++;
        } else if (!ca->is_dir && !cb->is_dir) {
            if (memcmp(prev_m->entries[ca->leaf_index].hash, next_m->entries[cb->leaf_index].hash, CBERG_HASH_LEN) !=
                0) {
                st = path_push(modified, next_m->entries[cb->leaf_index].path);
            }
            i++;
            j++;
        } else {
            if (ca->is_dir) {
                st = collect_files(prev_m, ca->dir, deleted);
            } else {
                st = path_push(deleted, prev_m->entries[ca->leaf_index].path);
            }
            if (st == CBERG_OK) {
                if (cb->is_dir) {
                    st = collect_files(next_m, cb->dir, added);
                } else {
                    st = path_push(added, next_m->entries[cb->leaf_index].path);
                }
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
    cberg_status st = diff_node(prev, prev->root, next, next->root, &added, &modified, &deleted);
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

/* ----------------------------------------------------------- persistence */

/*
 * Saved leaves only: each file's (size, mtime, body hash, path), in the build's
 * path-sorted order. The directory tree is regenerated on load from these
 * leaves (manifest_build_tree), so it never has to be serialized. A magic and
 * version guard means a stale or foreign file reads back as NOT_FOUND, and the
 * caller does a full rebuild.
 */
#define CBERG_MANIFEST_MAGIC "CBMF"
#define CBERG_MANIFEST_VERSION 1u

cberg_status cberg_manifest_save(const cberg_manifest *manifest, const char *path) {
    if (manifest == NULL || path == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char tmp[4096];
    int n = snprintf(tmp, sizeof tmp, "%s.tmp", path);
    if (n < 0 || (size_t)n >= sizeof tmp) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    FILE *f = fopen(tmp, "wb");
    if (f == NULL) {
        return CBERG_ERR_IO;
    }
    cberg_status st = CBERG_OK;
    uint32_t version = CBERG_MANIFEST_VERSION;
    uint64_t count = manifest->len;
    if (fwrite(CBERG_MANIFEST_MAGIC, 1, 4, f) != 4 || fwrite(&version, sizeof version, 1, f) != 1 ||
        fwrite(&count, sizeof count, 1, f) != 1) {
        st = CBERG_ERR_IO;
        goto fail;
    }
    for (size_t i = 0; i < manifest->len; i++) {
        uint64_t size = manifest->meta[i].size;
        int64_t mtime = manifest->meta[i].mtime_ns;
        size_t plen = strlen(manifest->entries[i].path);
        if (plen > 0xFFFFFFFFu) {
            st = CBERG_ERR_INVALID_ARGUMENT;
            goto fail;
        }
        uint32_t plen32 = (uint32_t)plen;
        if (fwrite(&size, sizeof size, 1, f) != 1 || fwrite(&mtime, sizeof mtime, 1, f) != 1 ||
            fwrite(manifest->entries[i].hash, 1, CBERG_HASH_LEN, f) != CBERG_HASH_LEN ||
            fwrite(&plen32, sizeof plen32, 1, f) != 1 ||
            (plen32 > 0 && fwrite(manifest->entries[i].path, 1, plen32, f) != plen32)) {
            st = CBERG_ERR_IO;
            goto fail;
        }
    }
    if (fflush(f) != 0) {
        st = CBERG_ERR_IO;
        goto fail;
    }
    if (fclose(f) != 0) {
        f = NULL;
        st = CBERG_ERR_IO;
        goto fail;
    }
    if (rename(tmp, path) != 0) {
        st = CBERG_ERR_IO;
        remove(tmp);
        return st;
    }
    return CBERG_OK;

fail:
    if (f != NULL) {
        fclose(f);
    }
    remove(tmp);
    return st;
}

cberg_status cberg_manifest_load(const char *path, cberg_manifest **out_manifest) {
    if (path == NULL || out_manifest == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_manifest = NULL;
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }

    char magic[4];
    uint32_t version = 0;
    uint64_t count = 0;
    if (fread(magic, 1, 4, f) != 4 || memcmp(magic, CBERG_MANIFEST_MAGIC, 4) != 0 ||
        fread(&version, sizeof version, 1, f) != 1 || version != CBERG_MANIFEST_VERSION ||
        fread(&count, sizeof count, 1, f) != 1) {
        fclose(f);
        return CBERG_ERR_NOT_FOUND;
    }

    cberg_manifest *m = calloc(1, sizeof(*m));
    if (m == NULL) {
        fclose(f);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    m->arena = cberg_arena_new();
    if (m->arena == NULL) {
        fclose(f);
        free(m);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = CBERG_OK;
    if (count > 0) {
        m->entries = malloc(count * sizeof(*m->entries));
        m->meta = malloc(count * sizeof(*m->meta));
        if (m->entries == NULL || m->meta == NULL) {
            st = CBERG_ERR_OUT_OF_MEMORY;
            goto fail;
        }
        for (uint64_t i = 0; i < count; i++) {
            uint64_t size = 0;
            int64_t mtime = 0;
            uint32_t plen = 0;
            uint8_t hash[CBERG_HASH_LEN];
            if (fread(&size, sizeof size, 1, f) != 1 || fread(&mtime, sizeof mtime, 1, f) != 1 ||
                fread(hash, 1, CBERG_HASH_LEN, f) != CBERG_HASH_LEN || fread(&plen, sizeof plen, 1, f) != 1) {
                st = CBERG_ERR_NOT_FOUND; /* truncated/corrupt -> cold start */
                goto fail;
            }
            char *p = cberg_arena_alloc(m->arena, (size_t)plen + 1);
            if (p == NULL) {
                st = CBERG_ERR_OUT_OF_MEMORY;
                goto fail;
            }
            if (plen > 0 && fread(p, 1, plen, f) != plen) {
                st = CBERG_ERR_NOT_FOUND;
                goto fail;
            }
            p[plen] = '\0';
            m->entries[m->len].path = p;
            memcpy(m->entries[m->len].hash, hash, CBERG_HASH_LEN);
            m->meta[m->len].size = size;
            m->meta[m->len].mtime_ns = mtime;
            m->len++;
        }
    }
    fclose(f);
    f = NULL;

    st = manifest_build_tree(m);
    if (st != CBERG_OK) {
        goto fail;
    }

    *out_manifest = m;
    return CBERG_OK;

fail:
    if (f != NULL) {
        fclose(f);
    }
    cberg_manifest_free(m);
    return st;
}
