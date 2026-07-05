#define _POSIX_C_SOURCE 200809L

#include "codeberg/codeberg.h"
#include "index_provider_harness.h"

#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(void) {
    char path[] = "/tmp/cberg_index_XXXXXX";
    int fd = mkstemp(path);
    if (fd >= 0) {
        close(fd);
        remove(path);
    }

    int failures = index_provider_harness_run("usearch", NULL, path, 4);
    failures += index_provider_test_usearch_expansion_restore();
    if (failures == 0) {
        printf("ok - index\n");
        return 0;
    }
    fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
}
