# Module: `src/watch/`

Recursive filesystem watcher — the **only** indexing trigger in core. Accumulates
repo-relative dirty paths with debouncing; platform-specific backends.

**Files:** `watch.c`, `watch_walk.c`, plus one platform backend (`watch_fsevents.c`,
`watch_inotify.c`, or `watch_poll.c`)  
**Depends on:** `common/pathutil`, `common/strmap`, `common/strutil`  
**Platform libs:** CoreServices (macOS), inotify (Linux)

---

## Constants

| Name | Value | Role |
|------|-------|------|
| `CBERG_WATCH_DEBOUNCE_MS` | 75 | FSEvents latency (seconds fraction on macOS) |
| `CBERG_DIR_INITIAL` | 64 | Initial watched-directory array capacity |

Dirty paths are stored in a **`cberg_strmap`** (256 buckets at first use).

---

## Internal types

### `cberg_watcher`

| Field | Purpose |
|-------|---------|
| `root`, `root_len` | Canonical watch root (no trailing slash except `/`) |
| `dirs[]`, `dir_len`, `dir_cap` | All registered directories |
| `dirty` | `cberg_strmap` of repo-relative path → `cberg_watch_kind` |
| `error` | Sticky status (e.g. OOM); poll/dirty_paths return it until `close` |
| `mu` | Recursive mutex; serializes dirty map / dir registration vs async delivery |
| **macOS:** `stream`, `event_queue` | FSEvents on a per-watcher serial queue; `FlushSync` in `wait` |
| **Linux:** `inotify_fd` | Non-blocking inotify instance |
| **fallback:** `files[]` | Per-file last `mtime` for poll scan |

---

## `watch_dirty_add` / `watch_dirty_drain`

`dirty_add` upserts into `dirty` and merges kinds. Returns `cberg_status`; sets sticky
`error` on failure.

`dirty_drain` stages all dirty paths (strdup) before clearing the map:

- **Transfer** (`events` or `paths` non-NULL): all-or-nothing — if more paths are pending
  than `cap`, returns `CBERG_ERR_INVALID_ARGUMENT` without clearing the map; otherwise
  transfers all and clears.
- **Count/discard** (both NULL): clears without transferring; `*out_count = total`;
  `cap` ignored.
- **OOM during staging:** returns `CBERG_ERR_OUT_OF_MEMORY`, sets sticky `error`, leaves
  the dirty map intact.

`poll` and `dirty_paths` share one drain — first caller consumes the set.

## `watch_walk_register(w, abs, rel)`

Uses `cberg_fs_walk` with `cberg_walk_skip_dir_cb` to register directories. On registration
failure, any allocated directory slot strings are freed before returning.

Skip policy is shared with the indexer and manifest via `configs/walk_skip_dirs.txt`
(see `cberg_walk_skip_dir` in `common/walk_policy.c`).

### `watch_rel_join` / `watch_note_created_subdir`

Shared helpers for building repo-relative paths and registering new subdirectories
(used by FSEvents and inotify backends).

---

## Platform backends

CMake selects exactly one of:

| File | Platform | `watch_platform_wait` |
|------|----------|------------------------|
| `watch_fsevents.c` | macOS | `usleep(timeout)` + `FSEventStreamFlushSync`; callback on serial queue |
| `watch_inotify.c` | Linux | `poll` + `read` inotify; always processes kernel events |
| `watch_poll.c` | fallback | `nanosleep` + full `cberg_fs_walk` mtime scan |

All backends implement `watch_platform_begin` / `finish` / `register_dir` / `stop` /
`destroy` / `wait`; only the selected file is linked.

Open sequence: `begin` → `watch_walk_register` → `finish` (Linux inotify in `begin`,
macOS FSEvents in `finish`, poll mtime seed in `finish`).

### macOS (`watch_fsevents.c`)

- **New directory** (`ItemIsDir` + `ItemCreated`) → `watch_walk_register`.
- **Removed** → `DELETE`; **Renamed** → `RENAME`; **Created** → `CREATE`; **Modified** → `MODIFY`.
- FSEvents stream on a per-watcher serial dispatch queue; `watch_platform_wait` calls
  `FSEventStreamFlushSync` before returning. Watcher state is protected by `mu`.

### Linux (`watch_inotify.c`)

- `watch_platform_register_dir` — `inotify_add_watch` per registered directory.
- `watch_platform_wait` — `poll` with timeout, then drain inotify buffer.
- New subdirectory → `watch_walk_register`; all events → `dirty_add`.

### Fallback (`watch_poll.c`)

- `watch_platform_init` — seed `files[]` mtimes via `cberg_fs_walk` (no dirty flood).
- `watch_platform_wait` — sleep then rescan tree; detect create/modify/delete by `mtime`.

---

## Public API (all platforms)

### `cberg_watcher_open` — public

`realpath` required (`CBERG_ERR_IO` on missing root). See [API.md](../API.md).

### `cberg_watcher_close` — public

Frees platform resources, all `dirs` strings, dirty map, `root`, struct.

### `cberg_watcher_poll` — public

Calls `watch_platform_wait`, then `dirty_drain` into `events` with accurate `kind`.
Caller frees each `events[i].path`. Empties the set for `dirty_paths`.

### `cberg_watcher_dirty_paths` — public

`dirty_drain` paths-only. **Same set as `poll`** — whichever runs first consumes all
pending paths. Caller frees each `paths[i]` when non-NULL.

---

## Design notes

- Watcher answers **which files** to re-read; `cberg_chunk_table_sync` decides **which chunks** changed.
- New directories created at runtime are registered on macOS (FSEvents) and Linux
  (`IN_CREATE` on parent); fallback relies on periodic full tree scan on poll.
- Debouncing: 75 ms on macOS FSEvents; Linux coalesces via dirty-set deduplication.
