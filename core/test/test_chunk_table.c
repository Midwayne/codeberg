#include "codeberg/codeberg.h"

#include <stdio.h>
#include <string.h>
#include <stdint.h>

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

static cberg_chunk make_chunk(const char *key, uint8_t salt) {
    cberg_chunk c = {
        .key = key,
        .path = "a.go",
        .symbol = "Fn",
        .kind = CBERG_CHUNK_FUNCTION,
        .span = {0, 10, 1, 3},
    };
    memset(c.content_hash, salt, CBERG_HASH_LEN);
    return c;
}

int main(void) {
    cberg_chunk_table *table = cberg_chunk_table_new();
    CHECK(table != NULL, "table new");

    cberg_chunk a[] = {make_chunk("a.go::1::Fn#0", 1), make_chunk("a.go::1::Fn#1", 2)};
    cberg_changes ch = {0};
    CHECK(cberg_chunk_table_sync(table, a, 2, &ch) == CBERG_OK, "sync cold");
    CHECK(ch.added_len == 2, "added 2");
    CHECK(ch.modified_len == 0, "no mod");
    CHECK(cberg_chunk_table_len(table) == 2, "len 2");

    uint8_t fp1[CBERG_HASH_LEN];
    cberg_chunk_table_fingerprint(table, fp1);

    cberg_chunk b[] = {make_chunk("a.go::1::Fn#0", 1), make_chunk("a.go::1::Fn#1", 9)};
    CHECK(cberg_chunk_table_sync(table, b, 2, &ch) == CBERG_OK, "sync inc");
    CHECK(ch.modified_len == 1, "one modified");
    CHECK(ch.added_len == 0, "no added");
    CHECK(ch.deleted_len == 0, "no deleted");

    uint8_t fp2[CBERG_HASH_LEN];
    cberg_chunk_table_fingerprint(table, fp2);
    CHECK(memcmp(fp1, fp2, CBERG_HASH_LEN) != 0, "fp changed");

    cberg_chunk empty = {0};
    CHECK(cberg_chunk_table_sync(table, &empty, 0, &ch) == CBERG_OK, "sync delete all");
    CHECK(ch.deleted_len == 2, "deleted all");
    CHECK(cberg_chunk_table_len(table) == 0, "empty table");

    cberg_chunk_table *dup_table = cberg_chunk_table_new();
    CHECK(dup_table != NULL, "dup table new");
    cberg_changes dup_ch = {0};
    cberg_chunk twice[] = {make_chunk("dup::1::X#0", 1), make_chunk("dup::1::X#0", 9)};
    CHECK(cberg_chunk_table_sync(dup_table, twice, 2, &dup_ch) == CBERG_OK, "dup incoming");
    CHECK(cberg_chunk_table_len(dup_table) == 1, "duplicate key not inserted twice");
    CHECK(dup_ch.added_len == 1, "one added in duplicate new batch");
    CHECK(dup_ch.added[0].chunk.content_hash[0] == 1, "added snapshot not mutated");
    CHECK(dup_ch.modified_len == 1, "duplicate batch updates once");
    CHECK(dup_ch.modified[0].chunk.content_hash[0] == 9, "modified has final hash");
    cberg_chunk_table_free(dup_table);

    cberg_chunk_table_free(table);
    return failures == 0 ? 0 : 1;
}
