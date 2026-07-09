#include "codeberg/codeberg.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "arena.h"
#include "binio.h"
#include "cacheline.h"
#include "grow.h"
#include "strmap.h"
#include "u64map.h"

_Static_assert(offsetof(cberg_chunk, content_hash) == 0, "content_hash leads cberg_chunk for cache-line compares");
_Static_assert(offsetof(cberg_chunk, content_hash) + CBERG_HASH_LEN <= CBERG_CACHE_LINE,
               "content_hash fits in one cache line");
_Static_assert(offsetof(cberg_stored_chunk, chunk.content_hash) + CBERG_HASH_LEN <= CBERG_CACHE_LINE,
               "stored id + content_hash fit in one cache line");

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

static cberg_status store_chunk_copy(cberg_arena *arena, const cberg_chunk *src, cberg_chunk *dst) {
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
    next->key_index = cberg_strmap_new(map_buckets);
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

static cberg_status table_append(cberg_chunk_table *table, cberg_stored_chunk stored) {
    if (table_reserve_entries(table, table->len + 1) != CBERG_OK) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    size_t index = table->len;
    table->entries[index] = stored;
    table->len++;
    if (table->key_index == NULL) {
        table->key_index = cberg_strmap_new(CBERG_MAP_INITIAL);
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

static cberg_status table_recompute_fingerprint(cberg_chunk_table *table) {
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
        cberg_status status = store_chunk_copy(next->arena, inc, &slot->chunk);
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
        cberg_status status = store_chunk_copy(next->arena, inc, &stored.chunk);
        if (status != CBERG_OK) {
            return status;
        }
        status = table_append(next, stored);
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
    cberg_status status = store_chunk_copy(next->arena, hash_changed ? inc : &existing->chunk, &stored.chunk);
    if (status != CBERG_OK) {
        return status;
    }
    status = table_append(next, stored);
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

cberg_status cberg_chunk_table_sync(cberg_chunk_table *table, const cberg_chunk *incoming, size_t count, cberg_changes *out_changes) {
    if (table == NULL || out_changes == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (count > 0 && incoming == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    cberg_chunk_table *next = calloc(1, sizeof(cberg_chunk_table));
    if (next == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    next->next_id = table->next_id;

    cberg_status status = CBERG_OK;
    size_t est_len = table->len + count;
    status = table_init_for_sync(next, est_len);
    if (status != CBERG_OK) {
        table_discard(next);
        return status;
    }

    status = table_ensure_seen(table, table->len);
    if (status != CBERG_OK) {
        table_discard(next);
        return status;
    }
    if (table->len > 0) {
        memset(table->sync_seen, 0, table->len * sizeof(bool));
    }
    bool *seen = table->sync_seen;

    for (size_t i = 0; i < count; i++) {
        const cberg_chunk *inc = &incoming[i];
        if (inc->key == NULL) {
            status = CBERG_ERR_INVALID_ARGUMENT;
            goto fail;
        }
        status = sync_apply_incoming(next, table, inc, seen);
        if (status != CBERG_OK) {
            goto fail;
        }
    }

    for (size_t i = 0; i < table->len; i++) {
        if (seen[i]) {
            continue;
        }
        /* Copy into next->arena: commit frees the live arena, so deleted snaps
         * must not borrow live string pointers. */
        cberg_stored_chunk snap = {.id = table->entries[i].id};
        status = store_chunk_copy(next->arena, &table->entries[i].chunk, &snap.chunk);
        if (status != CBERG_OK) {
            goto fail;
        }
        status = push_change_snap(&next->deleted, &next->deleted_len, &next->deleted_cap, &snap);
        if (status != CBERG_OK) {
            goto fail;
        }
    }

    if (next->deleted_len > 1) {
        qsort(next->deleted, next->deleted_len, sizeof(cberg_stored_chunk), compare_stored_id);
    }

    status = table_recompute_fingerprint(next);
    if (status != CBERG_OK) {
        goto fail;
    }

    table_commit(table, next);

    table_free_scratch(next);
    free(next);
    *out_changes = (cberg_changes){
        .added = table->added,
        .added_len = table->added_len,
        .modified = table->modified,
        .modified_len = table->modified_len,
        .deleted = table->deleted,
        .deleted_len = table->deleted_len,
    };
    return CBERG_OK;

fail:
    table_discard(next);
    return status;
}

/* ----------------------------------------------------------- persistence */

/*
 * On-disk snapshot of the id<->chunk mapping, so a restarted indexer can diff
 * the repository against the chunks it already embedded instead of treating
 * every chunk as new. Serialized with the shared binio helpers (see binio.h);
 * a magic and version guard means any mismatch (older format, different
 * machine) reads back as NOT_FOUND and the caller falls back to a cold
 * rebuild. Symbol may be absent; key and path never are.
 */
#define CBERG_CHUNK_TABLE_MAGIC "CBT1"
#define CBERG_CHUNK_TABLE_VERSION 1u

#define w_u32 cberg_bin_w_u32
#define w_u64 cberg_bin_w_u64
#define w_bytes cberg_bin_w_bytes
#define w_str cberg_bin_w_str
#define r_exact cberg_bin_r_exact
#define r_u32 cberg_bin_r_u32
#define r_u64 cberg_bin_r_u64
#define r_str cberg_bin_r_str

cberg_status cberg_chunk_table_save(const cberg_chunk_table *table, const char *path) {
    if (table == NULL || path == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    char tmp[4096];
    int n = snprintf(tmp, sizeof tmp, "%s.tmp", path);
    if (n < 0 || (size_t)n >= sizeof tmp) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    FILE *f = fopen(tmp, "wb");
    if (f == NULL) {
        return CBERG_ERR_IO;
    }
    cberg_status st = CBERG_OK;
    if (w_bytes(f, CBERG_CHUNK_TABLE_MAGIC, 4) != CBERG_OK || w_u32(f, CBERG_CHUNK_TABLE_VERSION) != CBERG_OK ||
        w_u64(f, table->next_id) != CBERG_OK || w_u64(f, table->len) != CBERG_OK) {
        st = CBERG_ERR_IO;
        goto fail;
    }
    for (size_t i = 0; i < table->len; i++) {
        const cberg_stored_chunk *sc = &table->entries[i];
        if (w_u64(f, sc->id) != CBERG_OK || w_u32(f, (uint32_t)sc->chunk.kind) != CBERG_OK ||
            w_u32(f, sc->chunk.span.start_byte) != CBERG_OK || w_u32(f, sc->chunk.span.end_byte) != CBERG_OK ||
            w_u32(f, sc->chunk.span.start_line) != CBERG_OK || w_u32(f, sc->chunk.span.end_line) != CBERG_OK ||
            w_bytes(f, sc->chunk.content_hash, CBERG_HASH_LEN) != CBERG_OK || w_str(f, sc->chunk.key) != CBERG_OK ||
            w_str(f, sc->chunk.path) != CBERG_OK || w_str(f, sc->chunk.symbol) != CBERG_OK) {
            st = CBERG_ERR_IO;
            goto fail;
        }
    }
    if (fflush(f) != 0) {
        st = CBERG_ERR_IO;
        goto fail;
    }
    if (fclose(f) != 0) {
        f = NULL;
        st = CBERG_ERR_IO;
        goto fail;
    }
    if (rename(tmp, path) != 0) {
        st = CBERG_ERR_IO;
        remove(tmp);
        return st;
    }
    return CBERG_OK;

fail:
    if (f != NULL) {
        fclose(f);
    }
    remove(tmp);
    return st;
}

cberg_status cberg_chunk_table_load(const char *path, cberg_chunk_table **out_table) {
    if (path == NULL || out_table == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_table = NULL;
    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }

    char magic[4];
    uint32_t version = 0;
    uint64_t next_id = 0, count = 0;
    if (r_exact(f, magic, 4) != CBERG_OK || memcmp(magic, CBERG_CHUNK_TABLE_MAGIC, 4) != 0 ||
        r_u32(f, &version) != CBERG_OK || version != CBERG_CHUNK_TABLE_VERSION || r_u64(f, &next_id) != CBERG_OK ||
        r_u64(f, &count) != CBERG_OK) {
        fclose(f);
        return CBERG_ERR_NOT_FOUND;
    }

    cberg_chunk_table *table = cberg_chunk_table_new();
    if (table == NULL) {
        fclose(f);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = CBERG_OK;
    for (uint64_t i = 0; i < count; i++) {
        cberg_stored_chunk stored = {0};
        uint32_t kind = 0;
        char *key = NULL, *path_str = NULL, *symbol = NULL;
        if (r_u64(f, &stored.id) != CBERG_OK || r_u32(f, &kind) != CBERG_OK ||
            r_u32(f, &stored.chunk.span.start_byte) != CBERG_OK ||
            r_u32(f, &stored.chunk.span.end_byte) != CBERG_OK ||
            r_u32(f, &stored.chunk.span.start_line) != CBERG_OK ||
            r_u32(f, &stored.chunk.span.end_line) != CBERG_OK ||
            r_exact(f, stored.chunk.content_hash, CBERG_HASH_LEN) != CBERG_OK || r_str(f, &key) != CBERG_OK ||
            r_str(f, &path_str) != CBERG_OK || r_str(f, &symbol) != CBERG_OK || key == NULL || path_str == NULL) {
            free(key);
            free(path_str);
            free(symbol);
            st = CBERG_ERR_NOT_FOUND; /* truncated/corrupt -> cold start */
            break;
        }
        stored.chunk.kind = (cberg_chunk_kind)kind;
        /* r_str returns malloc strings; copy into the table arena then free. */
        cberg_chunk tmp = {
            .key = key,
            .path = path_str,
            .symbol = symbol,
            .kind = (cberg_chunk_kind)kind,
            .span = stored.chunk.span,
        };
        memcpy(tmp.content_hash, stored.chunk.content_hash, CBERG_HASH_LEN);
        st = store_chunk_copy(table->arena, &tmp, &stored.chunk);
        free(key);
        free(path_str);
        free(symbol);
        if (st != CBERG_OK) {
            break;
        }
        st = table_append(table, stored);
        if (st != CBERG_OK) {
            break;
        }
    }
    fclose(f);
    if (st != CBERG_OK) {
        cberg_chunk_table_free(table);
        return st;
    }

    table->next_id = next_id;
    st = table_recompute_fingerprint(table);
    if (st != CBERG_OK) {
        cberg_chunk_table_free(table);
        return st;
    }

    *out_table = table;
    return CBERG_OK;
}
