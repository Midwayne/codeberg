#ifndef CBERG_BENCH_H
#define CBERG_BENCH_H

#include <stdint.h>
#include <stdio.h>
#include <time.h>

typedef struct {
    struct timespec start;
    struct timespec end;
} cberg_bench_timer;

static inline void cberg_bench_start(cberg_bench_timer *t) {
    clock_gettime(CLOCK_MONOTONIC, &t->start);
}

static inline void cberg_bench_stop(cberg_bench_timer *t) {
    clock_gettime(CLOCK_MONOTONIC, &t->end);
}

static inline double cberg_bench_seconds(const cberg_bench_timer *t) {
    return (double)(t->end.tv_sec - t->start.tv_sec) +
           (double)(t->end.tv_nsec - t->start.tv_nsec) / 1e9;
}

static inline double cberg_bench_ns_per_op(const cberg_bench_timer *t, uint64_t ops) {
    if (ops == 0) {
        return 0.0;
    }
    return cberg_bench_seconds(t) * 1e9 / (double)ops;
}

static inline void cberg_bench_report(const char *name, const cberg_bench_timer *t, uint64_t ops) {
    printf("%-28s %10.3f ms  %8.1f ns/op  (%llu ops)\n", name, cberg_bench_seconds(t) * 1e3,
           cberg_bench_ns_per_op(t, ops), (unsigned long long)ops);
}

#endif /* CBERG_BENCH_H */
