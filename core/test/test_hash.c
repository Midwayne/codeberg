#include "codeberg/codeberg.h"

#include <stdio.h>
#include <string.h>

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

int main(void) {
    uint8_t a[CBERG_HASH_LEN], b[CBERG_HASH_LEN];
    CHECK(cberg_hash("hello", 5, a) == CBERG_OK, "hash ok");
    CHECK(cberg_hash("hello", 5, b) == CBERG_OK, "hash ok2");
    CHECK(memcmp(a, b, CBERG_HASH_LEN) == 0, "deterministic");

    CHECK(cberg_hash("world", 5, b) == CBERG_OK, "hash world");
    CHECK(memcmp(a, b, CBERG_HASH_LEN) != 0, "different input");

    uint8_t empty[CBERG_HASH_LEN];
    CHECK(cberg_hash("", 0, empty) == CBERG_OK, "empty ok");
    CHECK(memcmp(a, empty, CBERG_HASH_LEN) != 0, "empty differs");
    return failures == 0 ? 0 : 1;
}
