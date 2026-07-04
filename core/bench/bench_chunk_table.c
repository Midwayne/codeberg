#include "bench.h"
#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static cberg_chunk make_chunk(char *keybuf, size_t cap, size_t i, uint8_t salt) {
    snprintf(keybuf, cap, "src/pkg/module/file_%zu.go::1::Symbol#%zu", i, i % 17);
    cberg_chunk c = {
        .key = keybuf,
        .path = "src/pkg/module/file.go",
        .symbol = "Symbol",
        .kind = CBERG_CHUNK_FUNCTION,
        .span = {0, 64, 1, 4},
    };
    memset(c.content_hash, salt, CBERG_HASH_LEN);
    return c;
}

typedef struct {
    cberg_chunk *chunks;
    char (*keys)[128];
} incoming_batch;

static incoming_batch build_incoming(size_t n) {
    incoming_batch batch = {0};
    batch.chunks = calloc(n, sizeof(cberg_chunk));
    batch.keys = calloc(n, 128);
    if (batch.chunks == NULL || batch.keys == NULL) {
        free(batch.chunks);
        free(batch.keys);
        batch.chunks = NULL;
        batch.keys = NULL;
        return batch;
    }
    for (size_t i = 0; i < n; i++) {
        batch.chunks[i] = make_chunk(batch.keys[i], 128, i, 1);
    }
    return batch;
}

static void free_incoming(incoming_batch *batch) {
    if (batch == NULL) {
        return;
    }
    free(batch->keys);
    free(batch->chunks);
    batch->keys = NULL;
    batch->chunks = NULL;
}

int main(void) {
    const size_t counts[] = {30000, 60000, 120000};
    const size_t find_rounds = 8;

    for (size_t c = 0; c < sizeof counts / sizeof counts[0]; c++) {
        size_t n = counts[c];
        incoming_batch incoming = build_incoming(n);
        if (incoming.chunks == NULL) {
            fprintf(stderr, "OOM incoming(%zu)\n", n);
            return 1;
        }

        cberg_chunk_table *table = cberg_chunk_table_new();
        cberg_changes ch = {0};
        if (table == NULL || cberg_chunk_table_sync(table, incoming.chunks, n, &ch) != CBERG_OK) {
            fprintf(stderr, "cold sync failed (%zu)\n", n);
            return 1;
        }

        /* Touch one chunk so the next sync exercises incremental rebuild. */
        incoming.chunks[0].content_hash[0] ^= 0x55;

        cberg_bench_timer t;
        cberg_bench_start(&t);
        if (cberg_chunk_table_sync(table, incoming.chunks, n, &ch) != CBERG_OK) {
            fprintf(stderr, "incremental sync failed (%zu)\n", n);
            return 1;
        }
        cberg_bench_stop(&t);
        char label[64];
        snprintf(label, sizeof label, "chunk_table inc sync %zu", n);
        cberg_bench_report(label, &t, n);

        const cberg_stored_chunk *mid = cberg_chunk_table_at(table, n / 2);
        if (mid == NULL) {
            fprintf(stderr, "missing mid entry\n");
            return 1;
        }
        uint64_t target_id = mid->id;

        cberg_bench_start(&t);
        size_t hits = 0;
        for (size_t round = 0; round < find_rounds; round++) {
            for (size_t i = 0; i < n; i++) {
                const cberg_stored_chunk *sc = cberg_chunk_table_find_by_id(table, target_id + (uint64_t)(i % 97));
                if (sc != NULL) {
                    hits++;
                }
            }
        }
        cberg_bench_stop(&t);
        snprintf(label, sizeof label, "chunk_table find_by_id %zu", n);
        cberg_bench_report(label, &t, n * find_rounds);
        if (hits == 0) {
            fprintf(stderr, "find_by_id sanity failed\n");
            return 1;
        }

        cberg_chunk_table_free(table);
        free_incoming(&incoming);
    }

    return 0;
}
