# Module: `src/chunk/`

Tree-sitter chunking and in-memory incremental change tracking.

**Files:** `chunker.c`, `chunk_table.c`, `chunk_keys.c`  
**Depends on:** `common/arena`, `common/hash`, `common/strmap`, tree-sitter + seven grammars

---

## `chunk_keys.c` / `chunk_keys.h`

Stable chunk identity strings and per-parse occurrence tracking.

### `chunk_format_key(buf, cap, path, kind, symbol, index)`

Canonical key: `"<path>::<kind>::<symbol>#<index>"`.

### `chunk_occ_new` / `chunk_occ_free` / `chunk_occ_next`

Heap-backed occurrence counter per `(path, kind, symbol)` using `cberg_strmap`.
Used by tree-sitter query extraction; window chunks use a linear counter instead.

---

## `chunker.c`

Turns source text into `cberg_chunk` records with stable keys and byte spans.

### Constants

| Name | Value | Role |
|------|-------|------|
| `CBERG_WINDOW_LINES` | 50 | Line count per fallback window |
| `CBERG_LANG_SLOTS` | 8 | Tree-sitter parser/query cache slots (grammar-backed languages only) |
| `CBERG_MD_SECTION_MAX_LINES` | 200 | Max lines per markdown section chunk before continuation |
| `CBERG_MD_TITLE_MAX` | 120 | Max bytes stored per heading title in breadcrumbs |

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
- **`cberg_chunker`** — `{ parsers[8], queries[8], query_lang[8] }` (markdown uses a separate line chunker).

### `descriptor_for(cberg_language lang)` — static

Switch mapping language enum → `lang_desc`. Unknown → `{ NULL, NULL }`.

### `lang_slot(cberg_language lang)` — static

Returns `(int)lang` as cache index for grammar-backed languages. `CBERG_LANG_MARKDOWN`
and `CBERG_LANG_UNKNOWN` are outside the slot range.

### `kind_from_capture(const char *name, uint32_t len)` — static

Matches capture name (`"function"`, `"method"`, …) to `cberg_chunk_kind`.

### `compare_chunks(const void *a, const void *b)` — static

Sort comparator by `span.start_byte` (used after query extraction).

### `list_reserve(cberg_chunk_list *list, size_t want)` — static

Doubles `items` capacity until `>= want`. **Returns:** `CBERG_OK` or `CBERG_ERR_OUT_OF_MEMORY`.

### `format_key(cberg_arena *arena, ...)` — static

Arena-allocates the result of `chunk_format_key`. **Returns:** `CBERG_OK`,
`CBERG_ERR_INVALID_ARGUMENT`, `CBERG_ERR_OUT_OF_MEMORY`.

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

### `markdown_chunk(path, src, src_len, out_list)` — static

Heading-aware chunker for `.md`/`.markdown` (no tree-sitter). Emits `CBERG_CHUNK_SECTION`
chunks:

- Each section runs from an ATX heading (`#` … `######`) to the line before the next
  heading (any level). Symbol is the breadcrumb of enclosing headings
  (`Install > Prerequisites`).
- Content before the first heading is an unnamed preamble section (skipped when
  whitespace-only).
- `#` inside fenced code blocks (`` ``` `` / `~~~`) does not split.
- Sections longer than `CBERG_MD_SECTION_MAX_LINES` continue as extra chunks under the
  same symbol; `chunk_occ_next` assigns `#0`, `#1`, …

**Not supported (v1):** setext headings (`Title\n===`), headings inside blockquotes or
list items (`> # Title`), and HTML blocks. Only ATX headings at line start (up to three
leading spaces) are recognized.

### `query_chunk(ch, desc, lang, path, src, src_len, out_list)` — static

1. `ensure_lang` → parse with `ts_parser_parse_string`.
2. `ts_query_cursor_exec` over compiled query.
3. For each match: read `@function`/`@method`/… node and optional `@name`.
4. Deduplicate keys: same `(path, kind, symbol)` gets incrementing `#n` suffix via
   local `occ_entry` table (max 256 distinct idents per file).
5. Sort chunks by start byte.

**Returns:** `CBERG_OK` or error; on error frees partial list.

### `cberg_chunker_parse` — public

- `CBERG_LANG_MARKDOWN` → `markdown_chunk` (heading sections).
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
    cberg_stored_chunk *entries;
    size_t len, cap;
    cberg_strmap *key_index;       // chunk key → index in entries
    cberg_u64map *id_index;        // stable chunk id → index in entries
    uint64_t next_id;
    uint8_t fingerprint[CBERG_HASH_LEN];
    cberg_stored_chunk *added, *modified, *deleted;
    size_t added_len, modified_len, deleted_len;
};
```

Key lookup uses `cberg_strmap` (see `common/strmap.c`). Id lookup uses `cberg_u64map`
(see `common/u64map.c`) for O(1) `find_by_id` after vector search.

### `rebuild_map(table)` — static

Clears `key_index` and re-inserts all keys. **Returns** `cberg_status` on failure.

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

**Algorithm (atomic staging):**

1. Build a temporary `cberg_chunk_table` (`next`) off to the side.
2. For each incoming chunk: look up in the **staged** table first, then the live table by key.
   - Duplicate keys within one batch update the staged row (not inserted twice).
   - Not found → deep-copy, new id, push to `added`.
   - Found, hash changed → deep-copy from incoming, same id, push to `modified`.
   - Found, hash unchanged → deep-copy from existing, same id.
3. For each live entry not seen in incoming → deep-copy owned snapshot to `deleted`.
4. Change lists (`added`/`modified`/`deleted`) own their chunk strings independently of `entries`.
4. Sort `deleted` by id when length > 1; recompute fingerprint on `next`.
5. On success: free old entries/map/change lists, swap `next` into the live table.
6. On failure: discard `next` only; **live table and prior change arrays are unchanged**.

Incoming chunks must have non-NULL `key` and valid `content_hash` (typically from
`cberg_chunk_list_hash_bodies`).

### `cberg_chunk_table_find_by_id` — public

O(1) lookup via `id_index`. Returns NULL when id not present. Pointer valid until
next `sync` (same as `cberg_chunk_table_at`).

### `cberg_chunk_table_save` / `cberg_chunk_table_load` — public

Atomic persistence (magic `CBT1`, version 1). Load restores stable ids for warm start
with a matching vector index. See [API.md](../API.md) and [CBERG_INDEX.md](../CBERG_INDEX.md).

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
