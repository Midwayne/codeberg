#include "codeberg/codeberg.h"

#include <stdlib.h>
#include <string.h>

#define XXH_STATIC_LINKING_ONLY
#include "xxhash.h"

static void digest128_to_out(XXH128_hash_t digest, uint8_t out[CBERG_HASH_LEN]) {
    memset(out, 0, CBERG_HASH_LEN);
    memcpy(out, &digest, sizeof(digest) < CBERG_HASH_LEN ? sizeof(digest) : CBERG_HASH_LEN);
}

cberg_status cberg_hash(const void *data, size_t len, uint8_t out[CBERG_HASH_LEN]) {
    if (out == NULL || (data == NULL && len > 0)) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    XXH128_hash_t digest = XXH3_128bits(data, len);
    digest128_to_out(digest, out);
    return CBERG_OK;
}

typedef struct {
    const char *key;
    const uint8_t *hash;
} fingerprint_leaf;

static int compare_leaf_keys(const void *a, const void *b) {
    const fingerprint_leaf *la = a;
    const fingerprint_leaf *lb = b;
    return strcmp(la->key, lb->key);
}

cberg_status cberg_fingerprint(const char *const *keys, const uint8_t *const *hashes, size_t count,
                               uint8_t out[CBERG_HASH_LEN]) {
    if (out == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    if (count == 0) {
        memset(out, 0, CBERG_HASH_LEN);
        return CBERG_OK;
    }
    if (keys == NULL || hashes == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }

    fingerprint_leaf *leaves = malloc(count * sizeof(fingerprint_leaf));
    if (leaves == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    for (size_t i = 0; i < count; i++) {
        if (keys[i] == NULL) {
            free(leaves);
            return CBERG_ERR_INVALID_ARGUMENT;
        }
        leaves[i].key = keys[i];
        leaves[i].hash = hashes[i];
    }
    qsort(leaves, count, sizeof(fingerprint_leaf), compare_leaf_keys);

    XXH3_state_t *state = XXH3_createState();
    if (state == NULL) {
        free(leaves);
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    XXH3_128bits_reset(state);
    static const uint8_t sep = 0x00;
    for (size_t i = 0; i < count; i++) {
        size_t key_len = strlen(leaves[i].key);
        XXH3_128bits_update(state, leaves[i].key, key_len);
        XXH3_128bits_update(state, &sep, 1);
        XXH3_128bits_update(state, leaves[i].hash, CBERG_HASH_LEN);
    }
    free(leaves);

    digest128_to_out(XXH3_128bits_digest(state), out);
    XXH3_freeState(state);
    return CBERG_OK;
}
