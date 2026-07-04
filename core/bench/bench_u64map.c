#include "bench.h"
#include "u64map.h"

#include <stdio.h>
#include <stdlib.h>

int main(void) {
    const size_t counts[] = {30000, 60000, 100000};
    const size_t lookup_rounds = 10;

    for (size_t c = 0; c < sizeof counts / sizeof counts[0]; c++) {
        size_t n = counts[c];
        cberg_u64map *map = cberg_u64map_new(n);
        if (map == NULL) {
            fprintf(stderr, "OOM u64map_new(%zu)\n", n);
            return 1;
        }

        cberg_bench_timer t;
        cberg_bench_start(&t);
        for (size_t i = 0; i < n; i++) {
            if (cberg_u64map_set(map, (uint64_t)(i + 1), (uint64_t)i) != CBERG_OK) {
                fprintf(stderr, "insert failed at %zu\n", i);
                return 1;
            }
        }
        cberg_bench_stop(&t);
        char label[64];
        snprintf(label, sizeof label, "u64map insert %zu", n);
        cberg_bench_report(label, &t, n);

        uint64_t found = 0;
        cberg_bench_start(&t);
        for (size_t round = 0; round < lookup_rounds; round++) {
            for (size_t i = 0; i < n; i++) {
                uint64_t v = 0;
                if (cberg_u64map_get(map, (uint64_t)(i + 1), &v)) {
                    found += v;
                }
            }
        }
        cberg_bench_stop(&t);
        snprintf(label, sizeof label, "u64map lookup hit %zu", n);
        cberg_bench_report(label, &t, n * lookup_rounds);
        if (found == 0) {
            fprintf(stderr, "lookup sanity failed\n");
            return 1;
        }

        cberg_bench_start(&t);
        for (size_t round = 0; round < lookup_rounds; round++) {
            for (size_t i = 0; i < n; i++) {
                uint64_t v = 0;
                (void)cberg_u64map_get(map, (uint64_t)(n + i + 1), &v);
            }
        }
        cberg_bench_stop(&t);
        snprintf(label, sizeof label, "u64map lookup miss %zu", n);
        cberg_bench_report(label, &t, n * lookup_rounds);

        cberg_u64map_free(map);
    }

    return 0;
}
