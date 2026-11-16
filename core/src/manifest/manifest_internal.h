/* Private to the manifest: the tree layout shared by manifest.c (build),
 * manifest_diff.c, and manifest_persist.c. */
#ifndef CBERG_MANIFEST_INTERNAL_H
#define CBERG_MANIFEST_INTERNAL_H

#include "codeberg/codeberg.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "arena.h"
#include "cacheline.h"

_Static_assert(offsetof(cberg_manifest_entry, hash) == 0, "manifest leaf hash leads the entry");
_Static_assert(offsetof(cberg_manifest_entry, hash) + CBERG_HASH_LEN <= CBERG_CACHE_LINE,
               "manifest leaf hash fits in one cache line");

struct manifest_node;

/* One child of a directory node: either a file (index into entries[]) or a subdirectory. */
typedef struct manifest_child {
    const char *name; /* basename, arena-owned */
    union {
        uint32_t leaf_index;       /* when !is_dir */
        struct manifest_node *dir; /* when is_dir */
    } u;
    bool is_dir;
} manifest_child;

_Static_assert(sizeof(manifest_child) == 24, "manifest_child stays compact");

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

/* Returns an empty manifest with its arena, or NULL when out of memory. */
cberg_manifest *manifest_new(void);

/* Builds the directory tree (and root hash) from m->entries, which must already
 * be populated and sorted by path. Shared by a fresh build and a load from disk;
 * uses only the stored leaf hashes, so it reads no files. */
cberg_status manifest_build_tree(cberg_manifest *m);

#endif /* CBERG_MANIFEST_INTERNAL_H */
