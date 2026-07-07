# Module: `src/common/`

Shared utilities used by chunking, watching, and hashing. None of these symbols are
exported in `codeberg.h` except where noted (status, version, hash, language).

**Files:** `arena.c`, `config.c`, `fileio.c`, `hash.c`, `lang.c`, `pathutil.c`, `status.c`, `strutil.c`, `strmap.c`, `u64map.c`, `version.c`, `walk_policy.c`  
**Headers:** `arena.h`, `fileio.h`, `pathutil.h`, `statutil.h`, `strutil.h`, `strmap.h`, `u64map.h`, `fnv.h`, `grow.h`, `walk_policy.h`  
**Third-party:** `third_party/xxhash.c` (linked from CMake, not under `src/common/`)

---

## `status.c`

### `cberg_status_str(cberg_status status)` — public

Maps each `cberg_status` enum to a static English string. Out-of-range values return
`"unknown error"`.

---

## `version.c`

### `cberg_version(void)` — public

Returns `CBERG_VERSION` compile definition (from repo root `VERSION` file via CMake).

---

## `config.c`

Process configuration via environment variables (no hardcoded index paths in the library).

### `cberg_config_index_root_env_name(void)` — public

Returns `CBERG_INDEX_ROOT_ENV` (`"CODEBERG_ROOT"`).

### `cberg_config_index_root(void)` — public

`getenv(CODEBERG_ROOT)`; NULL when unset or empty.

### `cberg_config_resolve_index_root(out, out_cap)` — public

Validates and resolves the configured index root into `out` using `realpath` (symlink
roots resolve to their target). Used by tooling before `cberg_watcher_open`.

---

## `lang.c`

### `cberg_language_from_path(const char *path)` — public

Inspects the substring after the last `.` in `path` and matches against a static table
of extensions (see [API.md](../API.md#cberg_language)). Case-sensitive. No extension
or NULL path → `CBERG_LANG_UNKNOWN`.

---

## `hash.c`

Depends on vendored **xxHash** (`XXH3_128bits`).

### `digest128_to_out(XXH128_hash_t digest, uint8_t out[CBERG_HASH_LEN])` — static

Zeroes `out`, copies the 16-byte XXH3-128 digest into the start. Shared by content hash
and set fingerprint.

### `cberg_hash(...)` — public

One-shot XXH3-128 over arbitrary bytes. See [API.md](../API.md#cberg_hash).

### `compare_leaf_keys(const void *a, const void *b)` — static

`qsort` comparator for fingerprint leaves; compares `key` strings with `strcmp`.

### `cberg_fingerprint(...)` — public

Builds temporary `fingerprint_leaf` array, sorts by key, streams into XXH3-128 state.
See [API.md](../API.md#cberg_fingerprint).

---

## `arena.c` / `arena.h`

Bump allocator for chunk list strings (keys, paths, symbols) and manifest tree
nodes. One arena per `cberg_chunk_list` / `cberg_manifest`; freed when the owner is
freed.

### Data structures

- **`cberg_arena_block`** — intrusive linked list node with flexible `data[]`, `cap`, `used`.
- **`cberg_arena`** — head pointer to block list.

`CBERG_ARENA_BLOCK` = 65536 bytes default block size.

### `cberg_arena_new(void)`

`calloc` a new empty arena. Returns NULL on OOM.

### `cberg_arena_free(cberg_arena *arena)`

Walks block list and frees all blocks and the arena struct. NULL-safe.

### `cberg_arena_reset(cberg_arena *arena)`

Sets `used = 0` on every block without freeing memory (reuse for future lists if ever
needed). NULL-safe.

### `arena_alloc(cberg_arena *arena, size_t size, size_t align)` — static

Allocates `size` bytes at `align` boundary from the head block. If insufficient room,
prepends a new block (at least `CBERG_ARENA_BLOCK` or `size + align - 1`). Returns NULL
on OOM. May recurse once if alignment pushes allocation past block end.

### `cberg_arena_alloc(cberg_arena *arena, size_t size)`

Raw `size`-byte allocation at 8-byte alignment (no copy, not zeroed). Returns NULL if
`arena` is NULL or allocation fails. Used for non-string records such as manifest tree
nodes and child-pointer arrays.

### `cberg_arena_dup(cberg_arena *arena, const char *src, size_t len)`

Copies `len` bytes from `src` into arena memory, NUL-terminates. Returns NULL if
`arena` or `src` is NULL or allocation fails.

### `cberg_arena_strdup(cberg_arena *arena, const char *src)`

`cberg_arena_dup` with `strlen(src)`. NULL `src` → NULL.

---

## `strutil.c` / `strutil.h`

### `cberg_strdup(const char *s)`

Heap duplicate; NULL in → NULL out. Used by watcher, chunk table, and `cberg_strmap`.

---

## `strmap.c` / `strmap.h`

String → `uint64_t` in-memory map (chained buckets, FNV-1a bucket index). **Not** for
content hashing — use `cberg_hash` (XXH3) for that.

### `cberg_strmap_new(bucket_count)` / `cberg_strmap_free` / `cberg_strmap_clear`

### `cberg_strmap_get` / `cberg_strmap_set`

Lookup and upsert. **Returns:** `CBERG_OK` or `CBERG_ERR_OUT_OF_MEMORY`.

### `cberg_strmap_visit(map, fn, ctx)`

Iterate all entries (used by watcher drain).

---

## `fnv.h` / `grow.h`

`cberg_fnv1a` — fast string hash for `cberg_strmap` bucket indices only.  
`cberg_grow_cap` — geometric capacity helper for dynamic arrays.

---

## `u64map.c` / `u64map.h`

Open-addressing `uint64_t` → `uint64_t` map. Internal only (not in `codeberg.h`).

- **Key 0 is reserved** as the empty-slot sentinel — `cberg_u64map_set` rejects key 0.
- Used by `cberg_chunk_table` for id → entry index (`find_by_id` in O(1)).
- 16-byte slots (4 pairs per 64-byte cache line).

### `cberg_u64map_new` / `cberg_u64map_free` / `cberg_u64map_get` / `cberg_u64map_set`

---

## `fileio.c` / `fileio.h`

### `cberg_read_file(const char *path, size_t *out_len)`

Reads an entire file into a malloc'd buffer. NUL-terminates at `buf[*out_len]`.
Returns NULL on failure; caller frees. Used by chunker callers and tests.

---

## `walk_policy.c` / `walk_policy.h`

### `cberg_walk_skip_dir(const char *name)` — public (via `codeberg.h`)

Returns non-zero for dependency/build directory basenames listed in
`configs/walk_skip_dirs.txt`. Shared by manifest, watcher, and indexer walks.

### `cberg_walk_skip_dir_cb(name, ctx)`

`cberg_fs_walk` skip callback wrapping `cberg_walk_skip_dir`.

---

## `pathutil.c` / `pathutil.h`

Path helpers shared by the watcher (and any future directory walks).

### `cberg_fs_walk_files(root, fn, ctx)`

File-only tree walk using `lstat` (no symlink follow) and `cberg_walk_skip_dir` on
directories. Used by the indexer bootstrap scan.

### `cberg_path_join(const char *root, const char *rel, char *out, size_t out_cap)`

Joins `root` and `rel` with `/` when needed. Writes NUL-terminated result to `out`.
Returns `false` on NULL inputs, zero `out_cap`, or buffer overflow.

### `cberg_path_resolve(path, out, out_cap)`

`realpath` into `out`. **Returns:** `CBERG_OK`, `CBERG_ERR_IO`, `CBERG_ERR_INVALID_ARGUMENT`.

### `cberg_fs_walk(abs, rel, fn, ctx, skip_dir, skip_ctx)`

Depth-first directory walk; always skips dot dirs. When `skip_dir` is non-NULL, also
skips directory names for which `skip_dir(name, skip_ctx)` returns true. Invokes `fn`
for each directory (pre-children) and regular file.

---

## `xxhash.c` (third_party)

Vendored xxHash implementation. Compiled with `XXH_STATIC_LINKING_ONLY`. Used only from
`hash.c` for `cberg_hash` and `cberg_fingerprint`. Not called directly elsewhere in core.
