#include "codeberg/codeberg.h"

#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

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

    /* id -> chunk lookup resolves live ids and rejects unknown ones. */
    const cberg_stored_chunk *e0 = cberg_chunk_table_at(table, 0);
    const cberg_stored_chunk *e1 = cberg_chunk_table_at(table, 1);
    uint64_t id0 = e0->id, id1 = e1->id;
    CHECK(cberg_chunk_table_find_by_id(table, id0) == e0, "find_by_id resolves entry 0");
    CHECK(cberg_chunk_table_find_by_id(table, id1) == e1, "find_by_id resolves entry 1");
    CHECK(cberg_chunk_table_find_by_id(table, 999999) == NULL, "find_by_id unknown id is NULL");

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

    /* id -> chunk still resolves after an in-place modify (ids are stable). */
    CHECK(cberg_chunk_table_find_by_id(table, id0) != NULL, "find_by_id resolves after modify");

    cberg_chunk empty = {0};
    CHECK(cberg_chunk_table_sync(table, &empty, 0, &ch) == CBERG_OK, "sync delete all");
    CHECK(ch.deleted_len == 2, "deleted all");
    CHECK(cberg_chunk_table_len(table) == 0, "empty table");
    CHECK(cberg_chunk_table_find_by_id(table, id0) == NULL, "find_by_id of deleted id is NULL");
    /* Deleted snaps must remain readable after commit (strings live in the new arena). */
    CHECK(ch.deleted[0].chunk.key != NULL && ch.deleted[0].chunk.path != NULL, "deleted[0] strings live");
    CHECK(ch.deleted[1].chunk.key != NULL && ch.deleted[1].chunk.path != NULL, "deleted[1] strings live");
    CHECK(strcmp(ch.deleted[0].chunk.path, "a.go") == 0, "deleted path readable");

    cberg_chunk_table *dup_table = cberg_chunk_table_new();
    CHECK(dup_table != NULL, "dup table new");
    cberg_changes dup_ch = {0};
    cberg_chunk twice[] = {make_chunk("dup::1::X#0", 1), make_chunk("dup::1::X#0", 9)};
    CHECK(cberg_chunk_table_sync(dup_table, twice, 2, &dup_ch) == CBERG_OK, "dup incoming");
    CHECK(cberg_chunk_table_len(dup_table) == 1, "duplicate key not inserted twice");
    CHECK(dup_ch.added_len == 1, "one added in duplicate new batch");
    CHECK(dup_ch.added[0].chunk.content_hash[0] == 9, "added snapshot is final hash (later wins)");
    CHECK(dup_ch.modified_len == 0, "duplicate within new batch does not also emit modified");
    cberg_chunk_table_free(dup_table);

    /* Failed sync must leave the live table and prior change arrays intact. */
    {
        cberg_chunk_table *live = cberg_chunk_table_new();
        cberg_changes lch = {0};
        cberg_chunk seed = make_chunk("fail::1::X#0", 1);
        CHECK(cberg_chunk_table_sync(live, &seed, 1, &lch) == CBERG_OK, "seed before fail");
        CHECK(lch.added_len == 1, "seed added");
        const char *prior_key = lch.added[0].chunk.key;
        CHECK(prior_key != NULL && strcmp(prior_key, "fail::1::X#0") == 0, "prior change key");
        cberg_chunk bad = make_chunk(NULL, 2); /* NULL key → INVALID_ARGUMENT */
        CHECK(cberg_chunk_table_sync(live, &bad, 1, &lch) == CBERG_ERR_INVALID_ARGUMENT, "fail sync");
        CHECK(cberg_chunk_table_len(live) == 1, "live len unchanged after fail");
        CHECK(cberg_chunk_table_find_by_key(live, "fail::1::X#0") != NULL, "live key intact");
        /* Prior change arrays unchanged (out_changes not rewritten on failure). */
        CHECK(lch.added_len == 1 && lch.added[0].chunk.key == prior_key, "prior changes untouched");
        cberg_chunk_table_free(live);
    }

    /* --- persistence: save/load round-trip keeps ids stable, so a restarted
     *     indexer re-embeds nothing for unchanged chunks. --- */
    char tpath[256];
    snprintf(tpath, sizeof(tpath), "/tmp/cberg-chunktable-%d.bin", (int)getpid());

    cberg_chunk_table *src = cberg_chunk_table_new();
    cberg_changes sch = {0};
    cberg_chunk seed[] = {make_chunk("p.go::1::A#0", 3), make_chunk("p.go::1::B#0", 4), make_chunk("p.go::1::C#0", 5)};
    seed[1].symbol = NULL;          /* NULL symbol exercises the sentinel encoding */
    seed[2].path = "deep/dir/q.go"; /* a path that differs from the others */
    CHECK(cberg_chunk_table_sync(src, seed, 3, &sch) == CBERG_OK, "seed sync");
    CHECK(cberg_chunk_table_len(src) == 3, "seed len 3");
    uint64_t id_a = cberg_chunk_table_at(src, 0)->id;
    uint8_t src_fp[CBERG_HASH_LEN];
    cberg_chunk_table_fingerprint(src, src_fp);

    cberg_chunk_table *missing = NULL;
    CHECK(cberg_chunk_table_load("/tmp/cberg-no-such-table-xyz.bin", &missing) == CBERG_ERR_NOT_FOUND,
          "absent file is a cold start");
    CHECK(missing == NULL, "absent load leaves out-param NULL");

    CHECK(cberg_chunk_table_save(src, tpath) == CBERG_OK, "save");

    cberg_chunk_table *restored = NULL;
    CHECK(cberg_chunk_table_load(tpath, &restored) == CBERG_OK, "load");
    CHECK(restored != NULL && cberg_chunk_table_len(restored) == 3, "restored len 3");

    uint8_t rfp[CBERG_HASH_LEN];
    cberg_chunk_table_fingerprint(restored, rfp);
    CHECK(memcmp(src_fp, rfp, CBERG_HASH_LEN) == 0, "fingerprint survives round-trip");

    int ok_fields = 1, saw_null_symbol = 0;
    for (size_t i = 0; i < cberg_chunk_table_len(restored); i++) {
        const cberg_stored_chunk *sc = cberg_chunk_table_at(restored, i);
        const cberg_stored_chunk *os = cberg_chunk_table_at(src, i);
        if (sc->id != os->id || strcmp(sc->chunk.key, os->chunk.key) != 0 ||
            strcmp(sc->chunk.path, os->chunk.path) != 0 || sc->chunk.kind != os->chunk.kind ||
            sc->chunk.span.end_byte != os->chunk.span.end_byte ||
            memcmp(sc->chunk.content_hash, os->chunk.content_hash, CBERG_HASH_LEN) != 0) {
            ok_fields = 0;
        }
        if (sc->chunk.symbol == NULL && os->chunk.symbol == NULL) {
            saw_null_symbol = 1;
        }
    }
    CHECK(ok_fields, "ids and chunk fields preserved across load");
    CHECK(saw_null_symbol, "NULL symbol round-trips");

    /* The crux: re-syncing identical content against the restored table reports
     * no changes, so a restart would re-embed nothing. */
    cberg_changes rch = {0};
    cberg_chunk again[] = {make_chunk("p.go::1::A#0", 3), make_chunk("p.go::1::B#0", 4), make_chunk("p.go::1::C#0", 5)};
    again[1].symbol = NULL;
    again[2].path = "deep/dir/q.go";
    CHECK(cberg_chunk_table_sync(restored, again, 3, &rch) == CBERG_OK, "resync restored");
    CHECK(rch.added_len == 0 && rch.modified_len == 0 && rch.deleted_len == 0,
          "identical resync after load is a no-op");
    CHECK(cberg_chunk_table_at(restored, 0)->id == id_a, "id stable after load+resync");

    /* find_by_id works on restored table with stable ids */
    const cberg_stored_chunk *by_id = cberg_chunk_table_find_by_id(restored, id_a);
    CHECK(by_id != NULL, "find_by_id after load");
    CHECK(by_id->id == id_a, "find_by_id returns correct id");
    CHECK(strcmp(by_id->chunk.key, cberg_chunk_table_at(restored, 0)->chunk.key) == 0,
          "find_by_id key matches loaded row");

    /* corrupt snapshot is a cold start, not a crash */
    FILE *badf = fopen(tpath, "wb");
    CHECK(badf != NULL, "open corrupt path");
    fwrite("CBT1", 1, 4, badf);
    fclose(badf);
    cberg_chunk_table *corrupt = NULL;
    CHECK(cberg_chunk_table_load(tpath, &corrupt) == CBERG_ERR_NOT_FOUND, "truncated load rejected");
    CHECK(corrupt == NULL, "corrupt load leaves NULL");

    /* A genuinely new chunk gets a fresh id from the preserved next_id, never
     * colliding with a restored id. */
    cberg_chunk grow[] = {make_chunk("p.go::1::A#0", 3), make_chunk("p.go::1::B#0", 4), make_chunk("p.go::1::C#0", 5), make_chunk("p.go::1::D#0", 6)};
    grow[1].symbol = NULL;
    grow[2].path = "deep/dir/q.go";
    cberg_changes gch = {0};
    CHECK(cberg_chunk_table_sync(restored, grow, 4, &gch) == CBERG_OK, "add new after load");
    CHECK(gch.added_len == 1 && gch.modified_len == 0, "exactly one new chunk after load");
    CHECK(gch.added[0].id >= 4, "new id continues past restored ids");

    cberg_chunk_table_free(restored);
    cberg_chunk_table_free(src);
    remove(tpath);

    cberg_chunk_table_free(table);
    return failures == 0 ? 0 : 1;
}
