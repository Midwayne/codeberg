#include "bench.h"
#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <unistd.h>

/* Repeated saves of a clean 10k-vector index, as on no-op watcher events. */
int main(void) {
    char path[] = "/tmp/cberg-save-bench-XXXXXX";
    int fd = mkstemp(path);
    if (fd < 0) return 1;
    close(fd);
    unlink(path);

    cberg_index *index = NULL;
    if (cberg_index_open(path, 128, NULL, &index) != CBERG_OK) return 1;

    float vector[128];
    for (size_t i = 0; i < 10000; i++) {
        for (size_t j = 0; j < 128; j++) vector[j] = (float)((i * 17 + j * 31) % 101) / 101.0f;
        if (cberg_index_add(index, i + 1, vector) != CBERG_OK) return 1;
    }
    if (cberg_index_save(index) != CBERG_OK) return 1;

    size_t replacements = 0;
    cberg_bench_timer timer;
    cberg_bench_start(&timer);
    for (size_t i = 0; i < 20; i++) {
        struct stat before, after;
        if (stat(path, &before) != 0 || cberg_index_save(index) != CBERG_OK || stat(path, &after) != 0) return 1;
        replacements += before.st_ino != after.st_ino;
    }
    cberg_bench_stop(&timer);
    cberg_bench_report("20 clean index saves", &timer, 20);

    struct stat info;
    if (stat(path, &info) != 0) return 1;
    printf("snapshot_bytes=%lld replacements=%zu\n", (long long)info.st_size, replacements);
    cberg_index_close(index);
    unlink(path);
    return 0;
}
