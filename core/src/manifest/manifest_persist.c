#include "codeberg/codeberg.h"

#include "chunk_rules.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "manifest_internal.h"

/*
 * Saved leaves only: each file's (size, mtime, body hash, path), in the build's
 * path-sorted order. The directory tree is regenerated on load from these
 * leaves (manifest_build_tree), so it never has to be serialized. A magic and
 * version guard means a stale or foreign file reads back as NOT_FOUND, and the
 * caller does a full rebuild.
 */
#define CBERG_MANIFEST_MAGIC "CBMF"

#define CBERG_MANIFEST_FORMAT 1u

/* The manifest is the baseline the chunk table was built from, so it is only
 * valid under the chunking rules that produced it: the stored version pairs
 * the file format with those rules. Files written before the pairing hold a
 * bare 1 and are rejected, forcing one full re-chunk. */
#define CBERG_MANIFEST_VERSION ((CBERG_MANIFEST_FORMAT << 16) | CBERG_CHUNK_RULES_VERSION)

/* Writes one leaf: size, mtime, body hash, then the length-prefixed path. */
static cberg_status write_entry(FILE *f, const cberg_manifest *m, size_t i) {
    uint64_t size = m->meta[i].size;
    int64_t mtime = m->meta[i].mtime_ns;
    size_t plen = strlen(m->entries[i].path);
    if (plen > 0xFFFFFFFFu) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    uint32_t plen32 = (uint32_t)plen;

    bool ok = fwrite(&size, sizeof size, 1, f) == 1 && fwrite(&mtime, sizeof mtime, 1, f) == 1 &&
              fwrite(m->entries[i].hash, 1, CBERG_HASH_LEN, f) == CBERG_HASH_LEN && fwrite(&plen32, sizeof plen32, 1, f) == 1 &&
              (plen32 == 0 || fwrite(m->entries[i].path, 1, plen32, f) == plen32);
    return ok ? CBERG_OK : CBERG_ERR_IO;
}

static cberg_status write_snapshot(FILE *f, const cberg_manifest *m) {
    uint32_t version = CBERG_MANIFEST_VERSION;
    uint64_t count = m->len;
    if (fwrite(CBERG_MANIFEST_MAGIC, 1, 4, f) != 4 || fwrite(&version, sizeof version, 1, f) != 1 ||
        fwrite(&count, sizeof count, 1, f) != 1) {
        return CBERG_ERR_IO;
    }

    cberg_status st = CBERG_OK;
    for (size_t i = 0; st == CBERG_OK && i < m->len; i++) {
        st = write_entry(f, m, i);
    }
    return st;
}

/* Writes to "<path>.tmp" and renames it into place, so a crash mid-save
 * leaves the previous manifest intact. */
cberg_status cberg_manifest_save(const cberg_manifest *manifest, const char *path) {
    if (manifest == NULL || path == NULL) {
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

    cberg_status st = write_snapshot(f, manifest);
    if (st == CBERG_OK && fflush(f) != 0) {
        st = CBERG_ERR_IO;
    }
    if (fclose(f) != 0 && st == CBERG_OK) {
        st = CBERG_ERR_IO;
    }
    if (st == CBERG_OK && rename(tmp, path) != 0) {
        st = CBERG_ERR_IO;
    }

    if (st != CBERG_OK) {
        remove(tmp);
    }
    return st;
}

static bool read_header(FILE *f, uint64_t *count) {
    char magic[4];
    uint32_t version = 0;

    return fread(magic, 1, 4, f) == 4 && memcmp(magic, CBERG_MANIFEST_MAGIC, 4) == 0 &&
           fread(&version, sizeof version, 1, f) == 1 && version == CBERG_MANIFEST_VERSION && fread(count, sizeof *count, 1, f) == 1;
}

/* Reads the next leaf into m. A truncated or corrupt leaf is NOT_FOUND, which
 * makes the caller start cold. */
static cberg_status read_entry(FILE *f, cberg_manifest *m) {
    uint64_t size = 0;
    int64_t mtime = 0;
    uint32_t plen = 0;
    uint8_t hash[CBERG_HASH_LEN];
    if (fread(&size, sizeof size, 1, f) != 1 || fread(&mtime, sizeof mtime, 1, f) != 1 ||
        fread(hash, 1, CBERG_HASH_LEN, f) != CBERG_HASH_LEN || fread(&plen, sizeof plen, 1, f) != 1) {
        return CBERG_ERR_NOT_FOUND;
    }

    char *p = cberg_arena_alloc(m->arena, (size_t)plen + 1);
    if (p == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    if (plen > 0 && fread(p, 1, plen, f) != plen) {
        return CBERG_ERR_NOT_FOUND;
    }
    p[plen] = '\0';

    m->entries[m->len].path = p;
    memcpy(m->entries[m->len].hash, hash, CBERG_HASH_LEN);
    m->meta[m->len].size = size;
    m->meta[m->len].mtime_ns = mtime;
    m->len++;
    return CBERG_OK;
}

static cberg_status read_entries(FILE *f, cberg_manifest *m, uint64_t count) {
    if (count == 0) {
        return CBERG_OK;
    }

    m->entries = malloc(count * sizeof(*m->entries));
    m->meta = malloc(count * sizeof(*m->meta));
    if (m->entries == NULL || m->meta == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    cberg_status st = CBERG_OK;
    for (uint64_t i = 0; st == CBERG_OK && i < count; i++) {
        st = read_entry(f, m);
    }
    return st;
}

cberg_status cberg_manifest_load(const char *path, cberg_manifest **out_manifest) {
    if (path == NULL || out_manifest == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    *out_manifest = NULL;

    FILE *f = fopen(path, "rb");
    if (f == NULL) {
        return CBERG_ERR_NOT_FOUND;
    }

    uint64_t count = 0;
    if (!read_header(f, &count)) {
        fclose(f);
        return CBERG_ERR_NOT_FOUND;
    }

    cberg_manifest *m = manifest_new();
    cberg_status st = m != NULL ? read_entries(f, m, count) : CBERG_ERR_OUT_OF_MEMORY;
    fclose(f);

    if (st == CBERG_OK) {
        st = manifest_build_tree(m);
    }
    if (st != CBERG_OK) {
        cberg_manifest_free(m);
        return st;
    }

    *out_manifest = m;
    return CBERG_OK;
}
