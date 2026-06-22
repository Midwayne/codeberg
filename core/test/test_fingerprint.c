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
    const char *keys[] = {"b", "a", "c"};
    uint8_t ha[CBERG_HASH_LEN], hb[CBERG_HASH_LEN], hc[CBERG_HASH_LEN];
    memset(ha, 1, CBERG_HASH_LEN);
    memset(hb, 2, CBERG_HASH_LEN);
    memset(hc, 3, CBERG_HASH_LEN);
    const uint8_t *hashes[] = {hb, ha, hc};
    uint8_t fp1[CBERG_HASH_LEN], fp2[CBERG_HASH_LEN];
    CHECK(cberg_fingerprint(keys, hashes, 3, fp1) == CBERG_OK, "fp ok");

    const char *keys2[] = {"c", "a", "b"};
    const uint8_t *hashes2[] = {hc, ha, hb};
    CHECK(cberg_fingerprint(keys2, hashes2, 3, fp2) == CBERG_OK, "fp2 ok");
    CHECK(memcmp(fp1, fp2, CBERG_HASH_LEN) == 0, "order independent");

    hc[0] = 99;
    CHECK(cberg_fingerprint(keys2, hashes2, 3, fp2) == CBERG_OK, "fp3 ok");
    CHECK(memcmp(fp1, fp2, CBERG_HASH_LEN) != 0, "content change");

    uint8_t empty[CBERG_HASH_LEN];
    CHECK(cberg_fingerprint(NULL, NULL, 0, empty) == CBERG_OK, "empty ok");
    uint8_t zero[CBERG_HASH_LEN] = {0};
    CHECK(memcmp(empty, zero, CBERG_HASH_LEN) == 0, "empty zero");

    return failures == 0 ? 0 : 1;
}
