#define _POSIX_C_SOURCE 200809L

#include "codeberg/codeberg.h"
#include "wipe.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(void) {
    char temp[] = "/tmp/cberg-wipe-XXXXXX";
    int fd = mkstemp(temp);
    if (fd < 0) {
        return 1;
    }
    close(fd);
    unlink(temp);

    const char *root = "/repository-that-is-unavailable";
    uint8_t hash[CBERG_HASH_LEN];
    if (cberg_hash(root, strlen(root), hash) != CBERG_OK) {
        return 1;
    }

    char path[256];
    int len = snprintf(path, sizeof(path), "%s.", temp);
    for (size_t i = 0; i < 8; i++) {
        snprintf(path + len + 2 * i, sizeof(path) - len - 2 * i, "%02x", hash[i]);
    }

    FILE *file = fopen(path, "w");
    if (file == NULL) {
        return 1;
    }
    fputs("cached index", file);
    fclose(file);

    setenv("CBERG_INDEX_BACKEND", "usearch", 1);
    setenv("CBERG_MODEL", "/unavailable/model.onnx", 1);
    if (cberg_wipe_index(temp, root) != 0 || access(path, F_OK) == 0) {
        unlink(path);
        fprintf(stderr, "wipe did not remove the root namespace without a model\n");
        return 1;
    }

    if (cberg_wipe_index(temp, root) != 0) {
        fprintf(stderr, "wipe must be idempotent\n");
        return 1;
    }

    setenv("CBERG_INDEX_BACKEND", "invalid", 1);
    if (cberg_wipe_index(temp, root) == 0) {
        return 1;
    }

    return 0;
}
