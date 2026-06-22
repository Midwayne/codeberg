# Module: `src/chunk/`

Tree-sitter chunking and in-memory incremental change tracking.

**Files:** `chunker.c`, `chunk_table.c`  
**Depends on:** `common/arena`, `common/hash`, tree-sitter + seven grammars

---

## `chunker.c`

Turns source text into `cberg_chunk` records with stable keys and byte spans.

### Constants

| Name | Value | Role |
|------|-------|------|
| `CBERG_WINDOW_LINES` | 50 | Line count per fallback window |
| `CBERG_LANG_SLOTS` | 8 | Parser/query cache slots (one per enum value) |

### Tree-sitter queries (static strings)

Each language has a `lang_desc` `{ language_fn, query }`:

| Language | Captures |
|----------|----------|
| Go | `@function`, `@method`, `@struct`, `@interface` + `@name` |
| C | `@function`, `@struct` |
| JavaScript | `@function`, `@class`, `@method` |
| TypeScript | `@function`, `@class`, `@interface`, `@method` |
| Python | `@function`, `@class` |
| Java | `@class`, `@interface`, `@method` (constructors as methods) |
| Kotlin | `@function`, `@class` |

Capture names map to `cberg_chunk_kind` via `kind_from_capture`.

### Internal types

- **`lang_desc`** — `TSLanguage* (*)()` + query string.
- **`cberg_chunk_list`** — `{ arena, items[], len, cap }` (opaque in public API).
- **`cberg_chunker`** — `{ parsers[8], queries[8], query_lang[8] }`.

### `descriptor_for(cberg_language lang)` — static

Switch mapping language enum → `lang_desc`. Unknown → `{ NULL, NULL }`.

### `lang_slot(cberg_language lang)` — static

Returns `(int)lang` as cache index (enum values align with slots).

### `kind_from_capture(const char *name, uint32_t len)` — static

Matches capture name (`"function"`, `"method"`, …) to `cberg_chunk_kind`.

### `compare_chunks(const void *a, const void *b)` — static

Sort comparator by `span.start_byte` (used after query extraction).

### `list_reserve(cberg_chunk_list *list, size_t want)` — static

Doubles `items` capacity until `>= want`. **Returns:** `CBERG_OK` or `CBERG_ERR_OUT_OF_MEMORY`.

### `format_key(cberg_arena *arena, const char *path, cberg_chunk_kind kind, const char *symbol, uint32_t index, char **out_key)` — static

Builds `"<path>::<kind>::<symbol>#<index>"` into arena. Empty symbol allowed. **Returns:**
`CBERG_OK`, `CBERG_ERR_INVALID_ARGUMENT` (snprintf overflow), `CBERG_ERR_OUT_OF_MEMORY`.

### `list_push(...)` — static

Appends one chunk: copies path/symbol to arena, formats key, sets span/kind.
Increments list length. **Returns:** status from reserve/format.

### `cberg_chunker_open` — public

Allocates chunker; initializes all `query_lang` slots to `UNKNOWN`. See [API.md](../API.md).

### `free_lang_slot(cberg_chunker *ch, int slot)` — static

Deletes query and parser for slot; marks language unknown.

### `cberg_chunker_close` — public

Frees all language slots and chunker struct.

### `ensure_lang(cberg_chunker *ch, cberg_language lang, lang_desc desc, int slot, TSParser **out_parser, TSQuery **out_query)` — static

Lazy-init parser with `ts_parser_set_language` and query with `ts_query_new`. Recreates
query if language at slot changed. **Returns:** `CBERG_OK`, `CBERG_ERR_OUT_OF_MEMORY`,
`CBERG_ERR_INTERNAL`.

### `window_chunk(path, src, src_len, out_list)` — static

Fallback for unknown languages: scans `src` for newlines, emits `CBERG_CHUNK_WINDOW`
chunks every 50 lines (plus tail). Symbols NULL. Keys use `#<occurrence>`.

### `query_chunk(ch, desc, lang, path, src, src_len, out_list)` — static

1. `ensure_lang` → parse with `ts_parser_parse_string`.
2. `ts_query_cursor_exec` over compiled query.
3. For each match: read `@function`/`@method`/… node and optional `@name`.
4. Deduplicate keys: same `(path, kind, symbol)` gets incrementing `#n` suffix via
   local `occ_entry` table (max 256 distinct idents per file).
5. Sort chunks by start byte.

**Returns:** `CBERG_OK` or error; on error frees partial list.

### `cberg_chunker_parse` — public

- `CBERG_LANG_UNKNOWN` → `window_chunk`.
- Else `descriptor_for`; if no language → window chunk.
- Else `query_chunk`.

### `cberg_chunk_list_len` / `cberg_chunk_list_at` / `cberg_chunk_list_free` — public

Accessors; free destroys arena + items + list.

### `cberg_chunk_list_hash_bodies` — public

Per-chunk `cberg_hash` over source slice. Validates spans.

---

## `chunk_table.c`

In-memory store of all chunks for one indexed tree; produces add/modify/delete diffs.

### Data structures

```c
struct cberg_chunk_table {
    cberg_stored_chunk *entries;   // dense array
    size_t len, cap;
    cberg_map_entry **buckets;     // FNV-1a chained hash: key → index in entries
    size_t bucket_count;
    uint64_t next_id;
    uint8_t fingerprint[CBERG_HASH_LEN];
    // last sync outputs (owned until next sync):
    cberg_stored_chunk *added, *modified, *deleted;
    size_t added_len, modified_len, deleted_len;
};
```

### `fnv1a(const char *s)` — static

FNV-1a 64-bit hash for hash map bucket index.

### `map_clear(table)` — static

Frees all map entries and keys; nulls buckets.

### `map_insert(table, key, index)` — static

Inserts new chain head at `fnv1a(key) % bucket_count`. Lazy-allocates 1024 buckets.
**Returns:** `CBERG_OK` or `CBERG_ERR_OUT_OF_MEMORY`.

### `map_find(table, key)` — static

Linear search in bucket chain; NULL if missing.

### `rebuild_map(table)` — static

Clears map and re-inserts all `entries[i].chunk.key` → index `i` (after deletions).

### `reserve_entries(table, want)` — static

Geometric growth of `entries` array.

### `store_chunk_copy(src, dst)` — static

`strdup` key/path/symbol; copies kind, span, content_hash into heap-owned `dst`.

### `recompute_fingerprint(table)` — static

Collects keys and hash pointers from all entries; calls `cberg_fingerprint`.

### `cberg_chunk_table_new` — public

`calloc` table; `next_id = 1`.

### `cberg_chunk_table_free` — public

Frees map, all entry strings, change arrays, entries, table.

### `cberg_chunk_table_fingerprint` / `cberg_chunk_table_len` — public

See [API.md](../API.md).

### `compare_stored_id(a, b)` — static

Sorts deleted list by stable id ascending.

### `cberg_chunk_table_sync` — public

**Algorithm:**

1. Free previous `added`/`modified`/`deleted` buffers; allocate fresh (cap 8, grows).
2. `pre_len = table->len` before mutations; allocate `seen[pre_len]` bitmap.
3. For each incoming chunk:
   - Not in map → append entry, new id, `map_insert`, push to `added`.
   - In map → mark `seen[index]`; if `content_hash` differs → update fields in place,
     push to `modified` (id unchanged).
4. For `i in 0..pre_len-1` where `!seen[i]` → push to `deleted`.
5. If any deletions: compact `entries` (only seen rows), free removed strings,
   `rebuild_map`.
6. Sort `deleted` by id if length > 1.
7. `recompute_fingerprint`.

**Important:** Deletion pass only considers indices `< pre_len` so rows added in the
same sync are not immediately deleted.

Incoming chunks must have non-NULL `key` and valid `content_hash` (typically from
`cberg_chunk_list_hash_bodies`).

---

## Typical call sequence (one file)

```c
cberg_chunker_parse(ch, lang, path, src, len, &list);
cberg_chunk_list_hash_bodies(list, src, len);
// build array of cberg_chunk from list
cberg_chunk_table_sync(table, chunks, n, &changes);
// embed changes.added + changes.modified; index_remove deleted ids
cberg_chunk_list_free(list);
```
