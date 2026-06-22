# Module: `src/watch/`

Recursive filesystem watcher — the **only** indexing trigger in core. Accumulates
repo-relative dirty paths with debouncing; platform-specific backends.

**Files:** `watch.c`  
**Depends on:** `common/pathutil`  
**Platform libs:** CoreServices (macOS), inotify (Linux)

---

## Constants

| Name | Value | Role |
|------|-------|------|
| `CBERG_WATCH_DEBOUNCE_MS` | 75 | FSEvents latency (seconds fraction on macOS) |
| `CBERG_DIR_INITIAL` | 64 | Initial watched-directory array capacity |
| `CBERG_DIRY_INITIAL` | 64 | (unused name in code; dirty uses 256 buckets) |

Dirty path set uses **256** FNV-1a buckets at first use.

---

## Internal types

### `cberg_dirty_entry`

Singly linked list node: `char *path` (repo-relative), `cberg_watch_kind kind`, `next`.

### `kind_merge` / `dirty_add` / `dirty_drain` — static

See implementation in `watch.c`. `dirty_drain` is shared by `poll` (path + kind) and
`dirty_paths` (paths only).

### `cberg_watch_dir`

Per registered directory:

- `abs_path` — absolute path on disk
- `rel_path` — path relative to watch root (`""` for root)
- Linux only: `wd` — inotify watch descriptor

### `cberg_watcher`

| Field | Purpose |
|-------|---------|
| `root`, `root_len` | Canonical watch root (no trailing slash except `/`) |
| `dirs[]`, `dir_len`, `dir_cap` | All registered directories |
| `dirty_buckets[]`, `dirty_bucket_count` | Hash set of dirty relative paths |
| `pending[]`, `pending_len`, `pending_cap` | Reserved for event batching (legacy buffer) |
| **macOS:** `stream` | `FSEventStreamRef` with file-level events |
| **Linux:** `inotify_fd` | Non-blocking inotify instance |
| **fallback:** `files[]` | Per-file last `mtime` for poll scan |

---

## `path_hash(const char *s)` — static

FNV-1a 64-bit; same polynomial as chunk table map.

## `watcher_strdup(const char *s)` — static

Heap duplicate; NULL in → NULL out.

## `rel_from_abs(w, abs, rel_out, rel_cap)` — static

`realpath(abs)` then strip `w->root` prefix to produce repo-relative path in
`rel_out`. Returns `false` if outside root or buffer too small.

## `dirty_add(w, rel, kind)` — static

Idempotent insert; merges kinds via `kind_merge` when the path already exists.

## `dirty_drain(w, events, paths, cap, out_count)` — static

Drains the dirty set (see above). **One drain per cycle** — `poll` and `dirty_paths` share it.

## `reserve_dirs(w, want)` — static

Grows `dirs` array geometrically. **Returns:** `CBERG_OK` or `CBERG_ERR_OUT_OF_MEMORY`.

## `walk_register(w, abs, rel)` — static

Recursive directory registration:

1. Append `{ abs_path, rel_path }` to `dirs`.
2. Linux: `inotify_add_watch` on `abs` (`IN_CREATE | IN_DELETE | IN_MODIFY | IN_MOVED_*`).
3. `opendir` + iterate children; skip `.` / `..` and `cberg_path_skip_dir` names.
4. Recurse into subdirectories (`stat` follows symlinks — symlinked dirs are included).

**Returns:** `CBERG_OK`, `CBERG_ERR_OUT_OF_MEMORY`, `CBERG_ERR_IO` (inotify).

---

## Platform: macOS (`__APPLE__`)

### `fsevents_callback(...)` — static

FSEvents handler on global dispatch queue:

- **New directory** (`ItemIsDir` + `ItemCreated`) → `walk_register` to pick up new subtree.
- **Removed** → `dirty_add(..., DELETE)`
- **Renamed** → `RENAME`
- **Created** (files) → `CREATE`
- **Modified** → `MODIFY`

Paths from callback are converted with `rel_from_abs`.

### `cberg_watcher_open` (macOS section)

After `walk_register`:

- Creates `FSEventStream` on `root` with `kFSEventStreamEventIdSinceNow`, debounce interval,
  flags: `FileEvents`, `WatchRoot`, `NoDefer`.
- Attaches to global concurrent dispatch queue; `FSEventStreamStart`.

### `cberg_watcher_poll` (macOS)

If `timeout_ms > 0`, `usleep`. FSEvents run asynchronously on the dispatch queue and
call `dirty_add` with mapped kinds. Then `dirty_drain` into `events`.

### `cberg_watcher_close` (macOS)

Stop, invalidate, release FSEvent stream.

---

## Platform: Linux (`__linux__`)

### `watch_dir_linux(w, abs, rel)` — static

`inotify_add_watch` before incrementing `dir_len` index (wd stored on `dirs[dir_len]`).

### `dir_by_wd(w, wd)` — static

Linear search for watch descriptor → `cberg_watch_dir*`.

### `cberg_watcher_open` (Linux section)

`inotify_init1(IN_NONBLOCK | IN_CLOEXEC)` then `walk_register`.

### `cberg_watcher_poll` (Linux)

1. `poll(inotify_fd)` with `timeout_ms`.
2. `read` inotify buffer; for each event, resolve `rel` = `dir.rel_path/name`.
3. New subdirectory → `walk_register`.
4. Always `dirty_add(rel)` for file events.
5. `pr == 0` && `timeout_ms > 0` → `CBERG_ERR_TIMEOUT`.

### `cberg_watcher_close` (Linux)

`close(inotify_fd)`.

---

## Platform: fallback (no FSEvents, no inotify)

### `poll_scan_file(w, abs, rel)` — static

`stat` regular file; compare `st_mtime` to cached value in `w->files[]`. On change or
first sight → `dirty_add`. Grows `files` array as needed.

### `poll_scan_tree(w, abs, rel)` — static

Recursive `readdir`; skip dot dirs and skip-list; recurse dirs, `poll_scan_file` on files.

### `cberg_watcher_open` (fallback)

After `walk_register`, initial `poll_scan_tree` to seed mtimes (does not flood dirty set
except new files).

### `cberg_watcher_poll` (fallback)

`sleep(timeout)` then full `poll_scan_tree` from root.

---

## Public API (all platforms)

### `cberg_watcher_open` — public

`realpath` required (`CBERG_ERR_IO` on missing root). See [API.md](../API.md).

### `cberg_watcher_close` — public

Frees platform resources, all `dirs` strings, dirty linked lists, `root`, struct.

### `cberg_watcher_poll` — public

Backend wait, then `dirty_drain` into `events` with accurate `kind`. Caller frees each
`events[i].path`. Empties the set for `dirty_paths`.

### `cberg_watcher_dirty_paths` — public

`dirty_drain` paths-only. **Same set as `poll`** — whichever runs first consumes all
pending paths. Caller frees each `paths[i]` when non-NULL.

---

## Design notes

- Watcher answers **which files** to re-read; `cberg_chunk_table_sync` decides **which chunks** changed.
- New directories created at runtime are registered on macOS (FSEvents) and Linux
  (`IN_CREATE` on parent); fallback relies on periodic full tree scan on poll.
- Debouncing: 75 ms on macOS FSEvents; Linux coalesces via dirty-set deduplication.
