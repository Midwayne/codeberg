/* Private to the chunk table: its layout and the helpers chunk_table.c
 * (sync) shares with chunk_table_persist.c (save/load). */
#ifndef CBERG_CHUNK_TABLE_STORE_H
#define CBERG_CHUNK_TABLE_STORE_H

#include "codeberg/codeberg.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "arena.h"
#include "strmap.h"
#include "u64map.h"

#define CBERG_MAP_INITIAL 1024

struct cberg_chunk_table {
    cberg_stored_chunk *entries;
    size_t len;
    size_t cap;
    cberg_strmap *key_index;
    cberg_u64map *id_index; /* chunk id -> entries[] index, for O(1) lookup by id */
    uint64_t next_id;
    uint8_t fingerprint[CBERG_HASH_LEN];
    cberg_arena *arena; /* owns entry key/path/symbol strings */
    bool arena_has_deletions; /* compact deleted snapshot strings on the next sync */

    cberg_stored_chunk *added;
    size_t added_len;
    size_t added_cap;
    cberg_stored_chunk *modified;
    size_t modified_len;
    size_t modified_cap;
    cberg_stored_chunk *deleted;
    size_t deleted_len;
    size_t deleted_cap;

    /* Reused across sync/fingerprint to avoid per-call calloc churn. */
    bool *sync_seen;
    size_t sync_seen_cap;
    const char **fp_keys;
    const uint8_t **fp_hashes;
    size_t fp_scratch_cap;
};

/* Copies src's strings into arena and its fields into dst. */
cberg_status chunk_table_copy_chunk(cberg_arena *arena, const cberg_chunk *src, cberg_chunk *dst);

/* Appends a row whose strings the table arena already owns, indexing it by
 * key and id. */
cberg_status chunk_table_append(cberg_chunk_table *table, cberg_stored_chunk stored);

/* Recomputes the table fingerprint over its (key, content hash) rows. */
cberg_status chunk_table_refingerprint(cberg_chunk_table *table);

#endif /* CBERG_CHUNK_TABLE_STORE_H */
