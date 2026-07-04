#include "bench.h"
#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    char **keys;
    uint8_t (*hashes)[CBERG_HASH_LEN];
    const char **key_ptrs;
    const uint8_t **hash_ptrs;
} fingerprint_batch;

static fingerprint_batch build_batch(size_t n) {
    fingerprint_batch batch = {0};
    batch.keys = calloc(n, sizeof(char *));
    batch.hashes = calloc(n, CBERG_HASH_LEN);
    batch.key_ptrs = calloc(n, sizeof(char *));
    batch.hash_ptrs = calloc(n, sizeof(uint8_t *));
    if (batch.keys == NULL || batch.hashes == NULL || batch.key_ptrs == NULL || batch.hash_ptrs == NULL) {
        free(batch.keys);
        free(batch.hashes);
        free(batch.key_ptrs);
        free(batch.hash_ptrs);
        batch.keys = NULL;
        return batch;
    }
    for (size_t i = 0; i < n; i++) {
        batch.keys[i] = malloc(96);
        if (batch.keys[i] == NULL) {
            for (size_t j = 0; j < i; j++) {
                free(batch.keys[j]);
            }
            free(batch.keys);
            free(batch.hashes);
            free(batch.key_ptrs);
            free(batch.hash_ptrs);
            batch.keys = NULL;
            return batch;
        }
        snprintf(batch.keys[i], 96, "src/pkg/module/file_%zu.go::1::Symbol#%zu", i, i % 23);
        memset(batch.hashes[i], (uint8_t)(i & 0xff), CBERG_HASH_LEN);
        batch.key_ptrs[i] = batch.keys[i];
        batch.hash_ptrs[i] = batch.hashes[i];
    }
    return batch;
}

static void free_batch(fingerprint_batch *batch, size_t n) {
    if (batch == NULL) {
        return;
    }
    if (batch->keys != NULL) {
        for (size_t i = 0; i < n; i++) {
            free(batch->keys[i]);
        }
    }
    free(batch->keys);
    free(batch->hashes);
    free(batch->key_ptrs);
    free(batch->hash_ptrs);
    batch->keys = NULL;
}

int main(void) {
    const size_t counts[] = {30000, 60000, 120000};
    const size_t rounds = 3;

    for (size_t c = 0; c < sizeof counts / sizeof counts[0]; c++) {
        size_t n = counts[c];
        fingerprint_batch batch = build_batch(n);
        if (batch.keys == NULL) {
            fprintf(stderr, "OOM fingerprint batch(%zu)\n", n);
            return 1;
        }

        uint8_t out[CBERG_HASH_LEN];
        cberg_bench_timer t;
        cberg_bench_start(&t);
        for (size_t r = 0; r < rounds; r++) {
            if (cberg_fingerprint(batch.key_ptrs, batch.hash_ptrs, n, out) != CBERG_OK) {
                fprintf(stderr, "fingerprint failed (%zu)\n", n);
                return 1;
            }
        }
        cberg_bench_stop(&t);

        char label[64];
        snprintf(label, sizeof label, "fingerprint %zu", n);
        cberg_bench_report(label, &t, n * rounds);

        free_batch(&batch, n);
    }

    return 0;
}
