#define _POSIX_C_SOURCE 200809L

#include "bench.h"
#include "codeberg/codeberg.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define DIM 768
#define DEFAULT_VECTORS 12000
#define DEFAULT_QUERIES 2000
#define DEFAULT_K 10
#define WARMUP_OPS 200
#define DEFAULT_ROUNDS 5

typedef struct {
    uint32_t state;
} rng_t;

typedef struct {
    cberg_index *idx;
    float *queries;
    char path[64];
} bench_index_t;

static float rng_next(rng_t *r) {
    r->state = r->state * 1664525u + 1013904223u;
    return (float)(r->state & 0x00FFFFFFu) / (float)0x01000000u;
}

static void fill_random(rng_t *r, float *vec, size_t dim) {
    double sum_sq = 0.0;
    for (size_t i = 0; i < dim; i++) {
        float v = rng_next(r) * 2.0f - 1.0f;
        vec[i] = v;
        sum_sq += (double)v * (double)v;
    }
    float inv = (float)(1.0 / sqrt(sum_sq));
    for (size_t i = 0; i < dim; i++) {
        vec[i] *= inv;
    }
}

static void bench_index_close(bench_index_t *bi) {
    if (bi == NULL) {
        return;
    }
    if (bi->idx != NULL) {
        cberg_index_close(bi->idx);
        bi->idx = NULL;
    }
    free(bi->queries);
    bi->queries = NULL;
    if (bi->path[0] != '\0') {
        remove(bi->path);
        bi->path[0] = '\0';
    }
}

static cberg_status bench_index_build(bench_index_t *bi, size_t n, size_t nq, uint32_t seed) {
    memset(bi, 0, sizeof(*bi));
    strncpy(bi->path, "/tmp/cberg_bench_search_XXXXXX", sizeof(bi->path));
    int fd = mkstemp(bi->path);
    if (fd < 0) {
        return CBERG_ERR_IO;
    }
    close(fd);
    remove(bi->path);

    cberg_status st = cberg_index_open(bi->path, DIM, NULL, &bi->idx);
    if (st != CBERG_OK) {
        bench_index_close(bi);
        return st;
    }

    bi->queries = calloc(nq * DIM, sizeof(float));
    if (bi->queries == NULL) {
        bench_index_close(bi);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    float *vector = malloc(DIM * sizeof(float));
    if (vector == NULL) {
        bench_index_close(bi);
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    rng_t rng = {.state = seed};
    for (size_t i = 0; i < n; i++) {
        fill_random(&rng, vector, DIM);
        st = cberg_index_add(bi->idx, (uint64_t)(i + 1), vector);
        if (st != CBERG_OK) {
            free(vector);
            bench_index_close(bi);
            return st;
        }
    }
    for (size_t i = 0; i < nq; i++) {
        fill_random(&rng, bi->queries + i * DIM, DIM);
    }
    free(vector);
    return CBERG_OK;
}

static double bench_search_pass(cberg_index *idx, const float *queries, size_t nq, size_t k, uint64_t *out_ops) {
    uint64_t *ids = malloc(k * sizeof(uint64_t));
    float *scores = malloc(k * sizeof(float));
    if (ids == NULL || scores == NULL) {
        free(ids);
        free(scores);
        if (out_ops != NULL) {
            *out_ops = 0;
        }
        return 0.0;
    }

    for (size_t i = 0; i < WARMUP_OPS; i++) {
        size_t found = 0;
        (void)cberg_index_search(idx, queries + (i % nq) * DIM, k, NULL, ids, scores, &found);
    }

    cberg_bench_timer t;
    cberg_bench_start(&t);
    uint64_t ops = 0;
    for (size_t round = 0; round < nq; round++) {
        size_t found = 0;
        cberg_status st = cberg_index_search(idx, queries + round * DIM, k, NULL, ids, scores, &found);
        if (st != CBERG_OK || found == 0) {
            fprintf(stderr, "search failed at query %zu: %s found=%zu\n", round, cberg_status_str(st), found);
            break;
        }
        ops++;
    }
    cberg_bench_stop(&t);
    free(ids);
    free(scores);
    if (out_ops != NULL) {
        *out_ops = ops;
    }
    return cberg_bench_seconds(&t);
}

static void usage(const char *argv0) {
    fprintf(stderr,
            "usage: %s [-n vectors] [-q queries] [-k neighbors] [-r rounds]\n"
            "  Each round builds a fresh index, times search before/after compact.\n"
            "  Defaults: -n %zu -q %zu -k %zu -r %u (dim=%d)\n",
            argv0, (size_t)DEFAULT_VECTORS, (size_t)DEFAULT_QUERIES, (size_t)DEFAULT_K, DEFAULT_ROUNDS, DIM);
}

int main(int argc, char **argv) {
    size_t n = DEFAULT_VECTORS;
    size_t nq = DEFAULT_QUERIES;
    size_t k = DEFAULT_K;
    unsigned rounds = DEFAULT_ROUNDS;

    int opt;
    while ((opt = getopt(argc, argv, "n:q:k:r:h")) != -1) {
        switch (opt) {
        case 'n':
            n = (size_t)strtoull(optarg, NULL, 10);
            break;
        case 'q':
            nq = (size_t)strtoull(optarg, NULL, 10);
            break;
        case 'k':
            k = (size_t)strtoull(optarg, NULL, 10);
            break;
        case 'r':
            rounds = (unsigned)strtoul(optarg, NULL, 10);
            if (rounds < 1) {
                rounds = 1;
            }
            break;
        case 'h':
            usage(argv[0]);
            return 0;
        default:
            usage(argv[0]);
            return 1;
        }
    }

    if (n == 0 || nq == 0 || k == 0) {
        usage(argv[0]);
        return 1;
    }

    printf("bench_search: dim=%d vectors=%zu queries/round=%zu k=%zu rounds=%u\n", DIM, n, nq, k, rounds);

    double before_sum = 0.0;
    double after_sum = 0.0;
    double compact_sum = 0.0;
    double before_best = 1e300;
    double after_best = 1e300;

    for (unsigned r = 0; r < rounds; r++) {
        bench_index_t bi;
        uint32_t seed = 0xC0DEBEEFu + r;
        cberg_status st = bench_index_build(&bi, n, nq, seed);
        if (st != CBERG_OK) {
            fprintf(stderr, "round %u: build failed: %s\n", r + 1, cberg_status_str(st));
            return 1;
        }

        uint64_t ops = 0;
        double before_s = bench_search_pass(bi.idx, bi.queries, nq, k, &ops);
        double before_qps = (double)ops / before_s;
        before_sum += before_s;
        if (before_s < before_best) {
            before_best = before_s;
        }

        cberg_bench_timer ct;
        cberg_bench_start(&ct);
        st = cberg_index_compact(bi.idx);
        cberg_bench_stop(&ct);
        if (st != CBERG_OK) {
            fprintf(stderr, "round %u: compact failed: %s\n", r + 1, cberg_status_str(st));
            bench_index_close(&bi);
            return 1;
        }
        double compact_s = cberg_bench_seconds(&ct);
        compact_sum += compact_s;

        ops = 0;
        double after_s = bench_search_pass(bi.idx, bi.queries, nq, k, &ops);
        double after_qps = (double)ops / after_s;
        after_sum += after_s;
        if (after_s < after_best) {
            after_best = after_s;
        }

        printf("round %u: before %.0f qps  compact %.3f s  after %.0f qps  delta %+.1f%%\n", r + 1, before_qps,
               compact_s, after_qps, 100.0 * (after_qps / before_qps - 1.0));

        bench_index_close(&bi);
    }

    double before_mean = before_sum / (double)rounds;
    double after_mean = after_sum / (double)rounds;
    double compact_mean = compact_sum / (double)rounds;
    double before_qps_mean = (double)nq / before_mean;
    double after_qps_mean = (double)nq / after_mean;
    double before_qps_best = (double)nq / before_best;
    double after_qps_best = (double)nq / after_best;

    printf("\nsummary (%u rounds, fresh index each round):\n", rounds);
    printf("  search before compact: mean %.0f qps  best %.0f qps\n", before_qps_mean, before_qps_best);
    printf("  compact once:          mean %.3f s\n", compact_mean);
    printf("  search after compact:  mean %.0f qps  best %.0f qps\n", after_qps_mean, after_qps_best);
    printf("  search delta (mean):   %+.1f%%\n", 100.0 * (after_qps_mean / before_qps_mean - 1.0));
    printf("  search delta (best):   %+.1f%%\n", 100.0 * (after_qps_best / before_qps_best - 1.0));

    return 0;
}
