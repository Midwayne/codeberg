#include "codeberg/codeberg.h"

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "binio.h"
#include "chunk_table_store.h"

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

static bool write_stored(FILE *f, const cberg_stored_chunk *sc) {
    const cberg_chunk *c = &sc->chunk;
    return cberg_bin_w_u64(f, sc->id) == CBERG_OK && cberg_bin_w_u32(f, (uint32_t)c->kind) == CBERG_OK &&
           cberg_bin_w_u32(f, c->span.start_byte) == CBERG_OK && cberg_bin_w_u32(f, c->span.end_byte) == CBERG_OK &&
           cberg_bin_w_u32(f, c->span.start_line) == CBERG_OK && cberg_bin_w_u32(f, c->span.end_line) == CBERG_OK &&
           cberg_bin_w_bytes(f, c->content_hash, CBERG_HASH_LEN) == CBERG_OK && cberg_bin_w_str(f, c->key) == CBERG_OK &&
           cberg_bin_w_str(f, c->path) == CBERG_OK && cberg_bin_w_str(f, c->symbol) == CBERG_OK;
}

static bool write_snapshot(FILE *f, const cberg_chunk_table *table) {
    bool ok = cberg_bin_w_bytes(f, CBERG_CHUNK_TABLE_MAGIC, 4) == CBERG_OK &&
              cberg_bin_w_u32(f, CBERG_CHUNK_TABLE_VERSION) == CBERG_OK && cberg_bin_w_u64(f, table->next_id) == CBERG_OK &&
              cberg_bin_w_u64(f, table->len) == CBERG_OK;

    for (size_t i = 0; ok && i < table->len; i++) {
        ok = write_stored(f, &table->entries[i]);
    }
    return ok;
}

/* Writes to "<path>.tmp" and renames it into place, so a crash mid-save
 * leaves the previous snapshot intact. */
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

    bool ok = write_snapshot(f, table) && fflush(f) == 0;
    ok = fclose(f) == 0 && ok;

    if (!ok || rename(tmp, path) != 0) {
        remove(tmp);
        return CBERG_ERR_IO;
    }
    return CBERG_OK;
}

static bool read_header(FILE *f, uint64_t *next_id, uint64_t *count) {
    char magic[4];
    uint32_t version = 0;

    return cberg_bin_r_exact(f, magic, 4) == CBERG_OK && memcmp(magic, CBERG_CHUNK_TABLE_MAGIC, 4) == 0 &&
           cberg_bin_r_u32(f, &version) == CBERG_OK && version == CBERG_CHUNK_TABLE_VERSION &&
           cberg_bin_r_u64(f, next_id) == CBERG_OK && cberg_bin_r_u64(f, count) == CBERG_OK;
}

/* Reads one row into table. A truncated or corrupt row is NOT_FOUND, which
 * makes the caller start cold. */
static cberg_status load_stored(FILE *f, cberg_chunk_table *table) {
    cberg_stored_chunk stored = {0};
    cberg_chunk read = {0};
    uint32_t kind = 0;
    char *key = NULL;
    char *path = NULL;
    char *symbol = NULL;

    bool ok = cberg_bin_r_u64(f, &stored.id) == CBERG_OK && cberg_bin_r_u32(f, &kind) == CBERG_OK &&
              cberg_bin_r_u32(f, &read.span.start_byte) == CBERG_OK && cberg_bin_r_u32(f, &read.span.end_byte) == CBERG_OK &&
              cberg_bin_r_u32(f, &read.span.start_line) == CBERG_OK && cberg_bin_r_u32(f, &read.span.end_line) == CBERG_OK &&
              cberg_bin_r_exact(f, read.content_hash, CBERG_HASH_LEN) == CBERG_OK && cberg_bin_r_str(f, &key) == CBERG_OK &&
              cberg_bin_r_str(f, &path) == CBERG_OK && cberg_bin_r_str(f, &symbol) == CBERG_OK && key != NULL && path != NULL;

    cberg_status st = CBERG_ERR_NOT_FOUND;
    if (ok) {
        /* The binio strings are malloc'd; the table keeps arena copies. */
        read.kind = (cberg_chunk_kind)kind;
        read.key = key;
        read.path = path;
        read.symbol = symbol;
        st = chunk_table_copy_chunk(table->arena, &read, &stored.chunk);
    }
    if (st == CBERG_OK) {
        st = chunk_table_append(table, stored);
    }

    free(key);
    free(path);
    free(symbol);
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

    uint64_t next_id = 0;
    uint64_t count = 0;
    if (!read_header(f, &next_id, &count)) {
        fclose(f);
        return CBERG_ERR_NOT_FOUND;
    }

    cberg_chunk_table *table = cberg_chunk_table_new();
    cberg_status st = table != NULL ? CBERG_OK : CBERG_ERR_OUT_OF_MEMORY;
    for (uint64_t i = 0; st == CBERG_OK && i < count; i++) {
        st = load_stored(f, table);
    }
    fclose(f);

    if (st == CBERG_OK) {
        table->next_id = next_id;
        st = chunk_table_refingerprint(table);
    }
    if (st != CBERG_OK) {
        cberg_chunk_table_free(table);
        return st;
    }

    *out_table = table;
    return CBERG_OK;
}
