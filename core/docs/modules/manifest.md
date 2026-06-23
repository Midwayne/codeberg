# Module: `src/manifest/`

Content-derived **Merkle manifest** over one repository's files. Detects which
files changed without relying on filesystem-event watches — the change detector
that scales across many repositories where inotify watch counts run out.

**Files:** `manifest.c`
**Depends on:** `common/arena`, `common/hash` (`cberg_hash`, `cberg_fingerprint`),
`common/pathutil` (`cberg_fs_walk`), `watch` (`cberg_watch_skip_dir`)

---

## Why this exists

`cberg_watcher` answers "which files changed" by pushing OS events. That is ideal
for a single working tree, but it has two limits that bite at scale (e.g. 100
mirrored repos × 150 files):

- **inotify watch exhaustion** — one watch descriptor per directory, bounded by
  `fs.inotify.max_user_watches`. Thousands of directories silently drop events
  when the limit or the event queue overflows.
- **No two-snapshot diff** — the watcher cannot answer "did anything change since
  the last index?" after the process was down (e.g. across a `git pull`).

The manifest is **content-derived**: it re-hashes the tree and compares, so it
needs zero watches and survives missed events. See
[adr/0003-merkle-manifest-change-detection.md](../adr/0003-merkle-manifest-change-detection.md).

---

## Data model

A directory tree of `manifest_node`:

```c
typedef struct manifest_node {
    const char *name;                 // basename ("" at root), arena-owned
    const char *path;                 // full repo-relative path, arena-owned
    bool is_dir;
    uint8_t hash[CBERG_HASH_LEN];     // file: body digest; dir: rollup
    struct manifest_node **children;  // arena-owned, sorted by name (dirs only)
    size_t child_len;
} manifest_node;
```

- **Leaf hash** = `cberg_hash` (XXH3-128) over the file's bytes.
- **Directory hash** = `cberg_fingerprint` over its children's `(name, hash)`
  pairs — the same order-independent rollup used by the chunk table, reused here.
- **Root hash** = the root node's rollup. Equal roots ⇒ identical content.

The manifest also keeps a flat `cberg_manifest_entry[]` (path + hash) sorted by
path, exposed via `cberg_manifest_len` / `cberg_manifest_at` for bootstrapping a
cold index from every file.

All nodes, names, paths, and child arrays are bump-allocated from one
`cberg_arena`; `cberg_manifest_free` drops the arena in one shot plus the flat
`entries` array.

---

## Build — `cberg_manifest_build(root, &m)`

1. `cberg_fs_walk` the tree (skipping `.git`, `node_modules`, … via
   `cberg_watch_skip_dir`), reading + hashing each file into a flat leaf.
   Unreadable files are skipped, not fatal.
2. `qsort` leaves by repo-relative path.
3. Fold the sorted leaves into a tree (`build_subtree`). Because leaves are
   path-sorted, the children of any directory are **contiguous runs** sharing the
   same next path component, so the tree is built in one linear pass per level
   without extra lookups.
4. Roll directory hashes bottom-up; copy the root hash onto the manifest.

`CBERG_ERR_IO` if `root` itself cannot be opened; empty repo ⇒ zero leaves and an
all-zero root.

### Incremental rebuild — `cberg_manifest_rebuild(prev, root, &m)`

The from-scratch build re-reads **every** file — its cost is `O(total bytes)` of
I/O, dominated by reads, not by the (very fast) XXH3 hashing. The rebuild avoids
that: each leaf stores a `manifest_meta { size, mtime_ns }` stat fingerprint, and
on rebuild a file whose `size` **and** `mtime` match `prev` reuses `prev`'s leaf
hash **without reading the file**. Only changed and new files are read and hashed.

```
for each file under root:
    stat (no read)
    if prev has this path with the same size+mtime:  reuse prev leaf hash
    else:                                            read + hash   (count it)
```

`prev` is found by binary search over its path-sorted `entries`.
`cberg_manifest_hashed_count` reports how many files were actually read this build
(0 for an unchanged tree, the leaf count for a full build) — useful for monitoring
and the test suite. `cberg_manifest_build(root)` is exactly `rebuild(NULL, root)`.

This is the same stat-cache technique git uses for its index. **Caveat:** an edit
that keeps a file's size and lands within the filesystem's mtime resolution can be
missed (the classic "racy clean" case). Mitigate by running an occasional full
build (`prev = NULL`); the watcher, when available, covers the live-edit path. The
tree fold and diff are unchanged — only leaf computation became incremental.

### `build_subtree(...)` — static

Builds the node for `leaves[lo, hi)` sharing a `prefix`-byte directory path. Two
passes over the run: count immediate children, then build them. Directory
children recurse on their contiguous sub-run.

### `child_run(leaves, i, hi, prefix, &end, &is_dir)` — static

Returns the exclusive end of the child run starting at leaf `i` — the span of
leaves sharing the same next component at `prefix`. Files are runs of one;
directories gather every following leaf whose component matches and is followed
by `/`. Relies on path-sort guaranteeing siblings never interleave.

### `component_end` / `read_all` / `build_visit` — static

Path-component scan; whole-file read for hashing; the `cberg_fs_walk` callback
that hashes one file into the growing leaf array.

---

## Diff — `cberg_manifest_diff(prev, next, &changes)`

Top-down merge with **subtree pruning**:

```
diff_node(a, b):                       # same directory in both trees
    if a.hash == b.hash: return        # PRUNE — identical subtree, untouched
    merge a.children and b.children by name (both sorted):
        only in prev      -> collect_files → deleted
        only in next      -> collect_files → added
        both, files       -> hash differs ? modified
        both, dirs        -> diff_node(child_a, child_b)    # recurse
        file ↔ dir        -> delete old subtree + add new subtree
```

The opening root-hash compare is the **O(1) "did anything change" gate**; a
localized edit then costs `O(changed files + path depth)` instead of touching
every file. Children sort by `strcmp(name)`, which reproduces the path-sort order
exactly (siblings never interleave), so the two trees merge in lockstep.

`cberg_manifest_changes` holds three `const char**` path arrays:

| List | Borrows from | Meaning |
|------|--------------|---------|
| `added` | `next` | files only in the new tree |
| `modified` | `next` | same path, different content hash |
| `deleted` | `prev` | files only in the old tree |

Paths are valid until either manifest is freed. `cberg_manifest_diff_free`
releases the three arrays (not the strings).

---

## Intended use (per repo)

```c
cberg_manifest *prev = /* last-indexed manifest for this repo */;

cberg_manifest *next = NULL;
cberg_manifest_rebuild(prev, repo_root, &next);  // reads only changed files

uint8_t a[CBERG_HASH_LEN], b[CBERG_HASH_LEN];
cberg_manifest_root(prev, a);
cberg_manifest_root(next, b);
if (memcmp(a, b, CBERG_HASH_LEN) == 0) {
    cberg_manifest_free(next);          // repo unchanged — skip entirely
} else {
    cberg_manifest_changes ch = {0};
    cberg_manifest_diff(prev, next, &ch);
    // re-chunk ch.modified ∪ ch.added; purge chunks of ch.deleted
    cberg_manifest_diff_free(&ch);
    cberg_manifest_free(prev);          // next becomes the new baseline
}
```

One manifest per repository keeps the diff scoped to a single repo: a change in
one of 100 repos never costs work proportional to the other 99.

---

## Ownership and threading

| Object | Lifetime | Notes |
|--------|----------|-------|
| `cberg_manifest` | `build` / `rebuild` / `free` | owns one arena + flat entries and stat-meta arrays |
| `cberg_manifest_entry*` (from `_at`) | until `free` | borrows arena strings |
| `cberg_manifest_changes` | `diff` / `diff_free` | path arrays malloc'd; strings borrowed from the manifests |

Build and diff are pure over their inputs; distinct manifests can be built on
separate threads. A single manifest is read-only after `build`.
