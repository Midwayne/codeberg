# Module: `src/common/`

Shared utilities used by chunking, watching, and hashing. None of these symbols are
exported in `codeberg.h` except where noted (status, version, hash, language).

**Files:** `arena.c`, `config.c`, `hash.c`, `lang.c`, `pathutil.c`, `status.c`, `version.c`  
**Headers:** `arena.h`, `pathutil.h`  
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

Bump allocator for chunk list strings (keys, paths, symbols). One arena per
`cberg_chunk_list`; freed when the list is freed.

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

### `cberg_arena_dup(cberg_arena *arena, const char *src, size_t len)`

Copies `len` bytes from `src` into arena memory, NUL-terminates. Returns NULL if
`arena` or `src` is NULL or allocation fails.

### `cberg_arena_strdup(cberg_arena *arena, const char *src)`

`cberg_arena_dup` with `strlen(src)`. NULL `src` → NULL.

---

## `pathutil.c` / `pathutil.h`

Path helpers shared by the watcher (and any future directory walks).

### `cberg_path_skip_dir(const char *name)`

Returns `true` if a **single path component** `name` should be excluded from watches
and recursive registration:

`.git`, `node_modules`, `vendor`, `.venv`, `__pycache__`, `.next`, `dist`, `build`,
`target`, `.gradle`, `.idea`, `.terraform`.

NULL or empty → `false` (do not skip).

### `cberg_path_join(const char *root, const char *rel, char *out, size_t out_cap)`

Joins `root` and `rel` with `/` when needed. Writes NUL-terminated result to `out`.
Returns `false` on NULL inputs, zero `out_cap`, or buffer overflow.

---

## `xxhash.c` (third_party)

Vendored xxHash implementation. Compiled with `XXH_STATIC_LINKING_ONLY`. Used only from
`hash.c` for `cberg_hash` and `cberg_fingerprint`. Not called directly elsewhere in core.
