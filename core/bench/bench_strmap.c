#include "bench.h"
#include "strmap.h"
#include "strutil.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char *make_key(size_t i, char *buf, size_t cap) {
    snprintf(buf, cap, "src/pkg/module/file_%zu.go::1::SymbolName#%zu", i, i % 17);
    return buf;
}

int main(void) {
    const size_t counts[] = {30000, 60000, 120000};
    const size_t lookup_rounds = 4;

    for (size_t c = 0; c < sizeof counts / sizeof counts[0]; c++) {
        size_t n = counts[c];
        cberg_strmap *map = cberg_strmap_new(n);
        if (map == NULL) {
            fprintf(stderr, "OOM strmap_new(%zu)\n", n);
            return 1;
        }

        char keybuf[128];
        cberg_bench_timer t;

        cberg_bench_start(&t);
        for (size_t i = 0; i < n; i++) {
            if (cberg_strmap_set(map, make_key(i, keybuf, sizeof keybuf), (uint64_t)i) != CBERG_OK) {
                fprintf(stderr, "insert failed at %zu\n", i);
                return 1;
            }
        }
        cberg_bench_stop(&t);
        char label[64];
        snprintf(label, sizeof label, "strmap insert %zu", n);
        cberg_bench_report(label, &t, n);

        uint64_t found = 0;
        cberg_bench_start(&t);
        for (size_t round = 0; round < lookup_rounds; round++) {
            for (size_t i = 0; i < n; i++) {
                uint64_t v = 0;
                if (cberg_strmap_get(map, make_key(i, keybuf, sizeof keybuf), &v)) {
                    found += v;
                }
            }
        }
        cberg_bench_stop(&t);
        snprintf(label, sizeof label, "strmap lookup hit %zu", n);
        cberg_bench_report(label, &t, n * lookup_rounds);
        if (found == 0) {
            fprintf(stderr, "lookup sanity failed\n");
            return 1;
        }

        cberg_bench_start(&t);
        for (size_t round = 0; round < lookup_rounds; round++) {
            for (size_t i = 0; i < n; i++) {
                uint64_t v = 0;
                (void)cberg_strmap_get(map, make_key(i + n, keybuf, sizeof keybuf), &v);
            }
        }
        cberg_bench_stop(&t);
        snprintf(label, sizeof label, "strmap lookup miss %zu", n);
        cberg_bench_report(label, &t, n * lookup_rounds);

        cberg_strmap_free(map);
    }

    return 0;
}
