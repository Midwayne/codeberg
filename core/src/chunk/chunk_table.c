#include "codeberg/codeberg.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "arena.h"
#include "cacheline.h"
#include "chunk_table_internal.h"
#include "chunk_table_store.h"
#include "grow.h"
#include "strmap.h"
#include "u64map.h"

_Static_assert(offsetof(cberg_chunk, content_hash) == 0, "content_hash leads cberg_chunk for cache-line compares");
_Static_assert(offsetof(cberg_chunk, content_hash) + CBERG_HASH_LEN <= CBERG_CACHE_LINE,
               "content_hash fits in one cache line");
_Static_assert(offsetof(cberg_stored_chunk, chunk.content_hash) + CBERG_HASH_LEN <= CBERG_CACHE_LINE,
               "stored id + content_hash fit in one cache line");



static bool map_find(const cberg_chunk_table *table, const char *key, size_t *out_index) {
    if (table->key_index == NULL) {
        return false;
    }
    uint64_t index = 0;
    if (!cberg_strmap_get(table->key_index, key, &index)) {
        return false;
    }
    if (out_index != NULL) {
        *out_index = (size_t)index;
    }
    return true;
}

static cberg_status push_change(cberg_stored_chunk **list, size_t *len, size_t *cap, cberg_stored_chunk item) {
    size_t next_cap = cberg_grow_cap(*cap, *len + 1, 8);
    if (next_cap != *cap) {
        cberg_stored_chunk *grown = realloc(*list, next_cap * sizeof(cberg_stored_chunk));
        if (grown == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        *list = grown;
        *cap = next_cap;
    }
    (*list)[(*len)++] = item;
    return CBERG_OK;
}

cberg_status chunk_table_copy_chunk(cberg_arena *arena, const cberg_chunk *src, cberg_chunk *dst) {
    char *key = cberg_arena_strdup(arena, src->key);
    char *path = cberg_arena_strdup(arena, src->path);
    char *symbol = src->symbol != NULL ? cberg_arena_strdup(arena, src->symbol) : NULL;
    if (key == NULL || path == NULL || (src->symbol != NULL && symbol == NULL)) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    dst->key = key;
    dst->path = path;
    dst->symbol = symbol;
    dst->kind = src->kind;
    dst->span = src->span;
    memcpy(dst->content_hash, src->content_hash, CBERG_HASH_LEN);
    return CBERG_OK;
}

static void table_free_scratch(cberg_chunk_table *table) {
    free(table->sync_seen);
    free(table->fp_keys);
    free(table->fp_hashes);
    table->sync_seen = NULL;
    table->fp_keys = NULL;
    table->fp_hashes = NULL;
    table->sync_seen_cap = 0;
    table->fp_scratch_cap = 0;
}

static void table_adopt_scratch(cberg_chunk_table *dst, cberg_chunk_table *src) {
    if (src->fp_scratch_cap > dst->fp_scratch_cap) {
        free(dst->fp_keys);
        free(dst->fp_hashes);
        dst->fp_keys = src->fp_keys;
        dst->fp_hashes = src->fp_hashes;
        dst->fp_scratch_cap = src->fp_scratch_cap;
        src->fp_keys = NULL;
        src->fp_hashes = NULL;
        src->fp_scratch_cap = 0;
    }
}

static cberg_status table_ensure_seen(cberg_chunk_table *table, size_t len) {
    if (len <= table->sync_seen_cap) {
        return CBERG_OK;
    }
    bool *grown = realloc(table->sync_seen, len * sizeof(bool));
    if (grown == NULL && len > 0) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    table->sync_seen = grown;
    table->sync_seen_cap = len;
    return CBERG_OK;
}

static cberg_status table_ensure_fp_scratch(cberg_chunk_table *table, size_t len) {
    if (len <= table->fp_scratch_cap) {
        return CBERG_OK;
    }
    const char **keys = realloc(table->fp_keys, len * sizeof(char *));
    const uint8_t **hash_ptrs = realloc(table->fp_hashes, len * sizeof(uint8_t *));
    if ((keys == NULL || hash_ptrs == NULL) && len > 0) {
        free(keys);
        free(hash_ptrs);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    table->fp_keys = keys;
    table->fp_hashes = hash_ptrs;
    table->fp_scratch_cap = len;
    return CBERG_OK;
}

static cberg_status table_reserve_entries(cberg_chunk_table *table, size_t want) {
    size_t cap = cberg_grow_cap(table->cap, want, 64);
    if (cap == table->cap) {
        return CBERG_OK;
    }
    cberg_stored_chunk *grown = realloc(table->entries, cap * sizeof(cberg_stored_chunk));
    if (grown == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    table->entries = grown;
    table->cap = cap;
    return CBERG_OK;
}

static cberg_status table_init_for_sync(cberg_chunk_table *next, size_t est_len) {
    next->arena = cberg_arena_new();
    if (next->arena == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    if (table_reserve_entries(next, est_len) != CBERG_OK) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t map_buckets = cberg_round_pow2(est_len < 64 ? 64 : (est_len * 4 + 2) / 3);
    /* Keys are entry strings in next->arena, which lives exactly as long as this map. */
    next->key_index = cberg_strmap_new_borrowed(map_buckets);
    next->id_index = cberg_u64map_new(map_buckets);
    if (next->key_index == NULL || next->id_index == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    return CBERG_OK;
}

/* Change-list rows are shallow copies: content_hash/id by value, strings borrow
 * the table arena (valid until the next sync commits a new arena). */
static cberg_status push_change_snap(cberg_stored_chunk **list, size_t *len, size_t *cap, const cberg_stored_chunk *src) {
    return push_change(list, len, cap, *src);
}

/* Later duplicate in the same batch wins: refresh an existing change-list row
 * for `id` instead of appending another upsert for the same stable id. */
static int refresh_change_snap(cberg_stored_chunk *list, size_t len, const cberg_stored_chunk *src) {
    for (size_t i = 0; i < len; i++) {
        if (list[i].id == src->id) {
            list[i] = *src;
            return 1;
        }
    }
    return 0;
}

cberg_status chunk_table_append(cberg_chunk_table *table, cberg_stored_chunk stored) {
    if (table_reserve_entries(table, table->len + 1) != CBERG_OK) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t index = table->len;
    table->entries[index] = stored;
    table->len++;
    if (table->key_index == NULL) {
        table->key_index = cberg_strmap_new_borrowed(CBERG_MAP_INITIAL);
        if (table->key_index == NULL) {
            table->len--;
            /* arena-owned; discarded with table->arena */
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    if (cberg_strmap_set(table->key_index, stored.chunk.key, (uint64_t)index) != CBERG_OK) {
        table->len--;
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    if (table->id_index == NULL) {
        table->id_index = cberg_u64map_new(CBERG_MAP_INITIAL);
        if (table->id_index == NULL) {
            table->len--;
            /* arena-owned; discarded with table->arena */
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    if (cberg_u64map_set(table->id_index, stored.id, (uint64_t)index) != CBERG_OK) {
        table->len--;
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    return CBERG_OK;
}

cberg_status chunk_table_refingerprint(cberg_chunk_table *table) {
    if (table->len == 0) {
        memset(table->fingerprint, 0, CBERG_HASH_LEN);
        return CBERG_OK;
    }
    cberg_status st = table_ensure_fp_scratch(table, table->len);
    if (st != CBERG_OK) {
        return st;
    }
    for (size_t i = 0; i < table->len; i++) {
        table->fp_keys[i] = table->entries[i].chunk.key;
        table->fp_hashes[i] = table->entries[i].chunk.content_hash;
    }
    return cberg_fingerprint(table->fp_keys, table->fp_hashes, table->len, table->fingerprint);
}

static void table_free_change_lists(cberg_chunk_table *table) {
    /* Strings borrow table->arena; only the row arrays are heap-owned. */
    free(table->added);
    free(table->modified);
    free(table->deleted);
    table->added = NULL;
    table->modified = NULL;
    table->deleted = NULL;
    table->added_len = 0;
    table->modified_len = 0;
    table->deleted_len = 0;
    table->added_cap = 0;
    table->modified_cap = 0;
    table->deleted_cap = 0;
}

void cberg_chunk_table_release_changes(cberg_chunk_table *table) {
    if (table == NULL) {
        return;
    }
    table_free_change_lists(table);
}

static void table_discard(cberg_chunk_table *table) {
    if (table == NULL) {
        return;
    }
    table_free_change_lists(table);
    free(table->entries);
    cberg_strmap_free(table->key_index);
    cberg_u64map_free(table->id_index);
    table_free_scratch(table);
    cberg_arena_free(table->arena);
    free(table);
}

cberg_chunk_table *cberg_chunk_table_new(void) {
    cberg_chunk_table *table = calloc(1, sizeof(cberg_chunk_table));
    if (table == NULL) {
        return NULL;
    }
    table->arena = cberg_arena_new();
    if (table->arena == NULL) {
        free(table);
        return NULL;
    }
    table->next_id = 1;
    return table;
}

void cberg_chunk_table_free(cberg_chunk_table *table) {
    table_discard(table);
}

void cberg_chunk_table_fingerprint(const cberg_chunk_table *table, uint8_t out[CBERG_HASH_LEN]) {
    if (table == NULL || out == NULL) {
        return;
    }
    memcpy(out, table->fingerprint, CBERG_HASH_LEN);
}

size_t cberg_chunk_table_len(const cberg_chunk_table *table) {
    return table == NULL ? 0 : table->len;
}

const cberg_stored_chunk *cberg_chunk_table_at(const cberg_chunk_table *table, size_t index) {
    if (table == NULL || index >= table->len) {
        return NULL;
    }
    return &table->entries[index];
}

const cberg_stored_chunk *cberg_chunk_table_find_by_id(const cberg_chunk_table *table, uint64_t id) {
    if (table == NULL || table->id_index == NULL) {
        return NULL;
    }
    uint64_t index = 0;
    if (!cberg_u64map_get(table->id_index, id, &index) || (size_t)index >= table->len) {
        return NULL;
    }
    return &table->entries[index];
}

const cberg_stored_chunk *cberg_chunk_table_find_by_key(const cberg_chunk_table *table, const char *key) {
    if (table == NULL || key == NULL) {
        return NULL;
    }
    size_t index = 0;
    if (!map_find(table, key, &index) || index >= table->len) {
        return NULL;
    }
    return &table->entries[index];
}

static int compare_stored_id(const void *a, const void *b) {
    const cberg_stored_chunk *ca = a;
    const cberg_stored_chunk *cb = b;
    if (ca->id < cb->id) {
        return -1;
    }
    if (ca->id > cb->id) {
        return 1;
    }
    return 0;
}

static cberg_status sync_apply_incoming(cberg_chunk_table *next, const cberg_chunk_table *table, const cberg_chunk *inc, bool *seen) {
    size_t next_index = 0;
    if (map_find(next, inc->key, &next_index)) {
        cberg_stored_chunk *slot = &next->entries[next_index];
        size_t live_index = 0;
        if (map_find(table, inc->key, &live_index)) {
            seen[live_index] = true;
        }
        bool hash_changed = memcmp(slot->chunk.content_hash, inc->content_hash, CBERG_HASH_LEN) != 0;
        /* Prior slot strings stay in next->arena until commit/discard. */
        cberg_status status = chunk_table_copy_chunk(next->arena, inc, &slot->chunk);
        if (status != CBERG_OK) {
            return status;
        }
        if (!hash_changed) {
            return CBERG_OK;
        }
        if (refresh_change_snap(next->added, next->added_len, slot) ||
            refresh_change_snap(next->modified, next->modified_len, slot)) {
            return CBERG_OK;
        }
        return push_change_snap(&next->modified, &next->modified_len, &next->modified_cap, slot);
    }

    size_t live_index = 0;
    if (!map_find(table, inc->key, &live_index)) {
        cberg_stored_chunk stored = {.id = next->next_id++};
        cberg_status status = chunk_table_copy_chunk(next->arena, inc, &stored.chunk);
        if (status != CBERG_OK) {
            return status;
        }
        status = chunk_table_append(next, stored);
        if (status != CBERG_OK) {
            return status;
        }
        return push_change_snap(&next->added, &next->added_len, &next->added_cap, &next->entries[next->len - 1]);
    }

    seen[live_index] = true;
    const cberg_stored_chunk *existing = &table->entries[live_index];
    bool hash_changed = memcmp(existing->chunk.content_hash, inc->content_hash, CBERG_HASH_LEN) != 0;
    cberg_stored_chunk stored = {.id = existing->id};
    /* Always copy into next->arena so a failed sync never mutates live strings. */
    cberg_status status = chunk_table_copy_chunk(next->arena, hash_changed ? inc : &existing->chunk, &stored.chunk);
    if (status != CBERG_OK) {
        return status;
    }
    status = chunk_table_append(next, stored);
    if (status != CBERG_OK) {
        return status;
    }
    if (hash_changed) {
        return push_change_snap(&next->modified, &next->modified_len, &next->modified_cap, &next->entries[next->len - 1]);
    }
    return CBERG_OK;
}

static void table_commit(cberg_chunk_table *table, cberg_chunk_table *next) {
    free(table->entries);
    cberg_strmap_free(table->key_index);
    cberg_u64map_free(table->id_index);
    table_free_change_lists(table);
    cberg_arena_free(table->arena);

    table->entries = next->entries;
    table->len = next->len;
    table->cap = next->cap;
    table->key_index = next->key_index;
    table->id_index = next->id_index;
    table->next_id = next->next_id;
    table->arena = next->arena;
    table->arena_has_deletions = next->deleted_len != 0;
    next->arena = NULL;
    memcpy(table->fingerprint, next->fingerprint, CBERG_HASH_LEN);
    table->added = next->added;
    table->added_len = next->added_len;
    table->added_cap = next->added_cap;
    table->modified = next->modified;
    table->modified_len = next->modified_len;
    table->modified_cap = next->modified_cap;
    table->deleted = next->deleted;
    table->deleted_len = next->deleted_len;
    table->deleted_cap = next->deleted_cap;
    table_adopt_scratch(table, next);
}

/* An identical ordered set needs neither a replacement arena nor a fingerprint
 * sort. Comparing unique live keys in order also rejects incoming duplicates. */
static bool table_matches(cberg_chunk_table *table, const cberg_chunk *incoming, size_t count) {
    if (count != table->len || table->arena_has_deletions) {
        return false;
    }

    for (size_t i = 0; i < count; i++) {
        if (incoming[i].key == NULL || strcmp(incoming[i].key, table->entries[i].chunk.key) != 0) {
            return false;
        }
        if (memcmp(incoming[i].content_hash, table->entries[i].chunk.content_hash, CBERG_HASH_LEN) != 0) {
            return false;
        }
    }
    return true;
}

/* Marks every live row unseen; sync_apply_incoming marks the ones still
 * present. */
static cberg_status table_reset_seen(cberg_chunk_table *table) {
    cberg_status status = table_ensure_seen(table, table->len);
    if (status == CBERG_OK && table->len > 0) {
        memset(table->sync_seen, 0, table->len * sizeof(bool));
    }
    return status;
}

/* Live rows the sync did not see become deletes, ordered by id. Their
 * snapshots are copied into next->arena: commit frees the live arena, so
 * deleted snaps must not borrow live string pointers. */
static cberg_status sync_collect_deleted(cberg_chunk_table *next, const cberg_chunk_table *table, const bool *seen) {
    for (size_t i = 0; i < table->len; i++) {
        if (seen[i]) {
            continue;
        }

        cberg_stored_chunk snap = {.id = table->entries[i].id};
        cberg_status status = chunk_table_copy_chunk(next->arena, &table->entries[i].chunk, &snap.chunk);
        if (status == CBERG_OK) {
            status = push_change_snap(&next->deleted, &next->deleted_len, &next->deleted_cap, &snap);
        }
        if (status != CBERG_OK) {
            return status;
        }
    }

    if (next->deleted_len > 1) {
        qsort(next->deleted, next->deleted_len, sizeof(cberg_stored_chunk), compare_stored_id);
    }
    return CBERG_OK;
}

/* Builds next from incoming against the live table: added and modified rows
 * from incoming, deletes from unseen live rows, then the new fingerprint. */
static cberg_status sync_build(cberg_chunk_table *next, cberg_chunk_table *table, const cberg_chunk *incoming, size_t count) {
    cberg_status status = table_reset_seen(table);
    bool *seen = table->sync_seen;

    for (size_t i = 0; status == CBERG_OK && i < count; i++) {
        if (incoming[i].key == NULL) {
            return CBERG_ERR_INVALID_ARGUMENT;
        }
        status = sync_apply_incoming(next, table, &incoming[i], seen);
    }

    if (status == CBERG_OK) {
        status = sync_collect_deleted(next, table, seen);
    }
    if (status == CBERG_OK) {
        status = chunk_table_refingerprint(next);
    }
    return status;
}

static cberg_changes table_changes(const cberg_chunk_table *table) {
    return (cberg_changes){
        .added = table->added,
        .added_len = table->added_len,
        .modified = table->modified,
        .modified_len = table->modified_len,
        .deleted = table->deleted,
        .deleted_len = table->deleted_len,
    };
}

cberg_status cberg_chunk_table_sync(cberg_chunk_table *table, const cberg_chunk *incoming, size_t count, cberg_changes *out_changes) {
    if (table == NULL || out_changes == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (count > 0 && incoming == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    if (table_matches(table, incoming, count)) {
        table_free_change_lists(table);
        memset(out_changes, 0, sizeof(*out_changes));
        return CBERG_OK;
    }

    cberg_chunk_table *next = calloc(1, sizeof(cberg_chunk_table));
    if (next == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    next->next_id = table->next_id;

    /* Every row of `next` comes from `incoming` (unseen live rows become
     * deletes, not entries), so count bounds its length exactly. */
    cberg_status status = table_init_for_sync(next, count);
    if (status == CBERG_OK) {
        status = sync_build(next, table, incoming, count);
    }
    if (status != CBERG_OK) {
        table_discard(next);
        return status;
    }

    table_commit(table, next);
    table_free_scratch(next);
    free(next);

    *out_changes = table_changes(table);
    return CBERG_OK;
}
