#include "chunk_kind.h"

#include <strings.h>
#include <string.h>

typedef struct {
    const char *name;
    uint8_t name_len;
    cberg_chunk_kind kind;
} chunk_kind_entry;

static const chunk_kind_entry k_kinds[] = {
    {"function", 8, CBERG_CHUNK_FUNCTION},
    {"method", 6, CBERG_CHUNK_METHOD},
    {"class", 5, CBERG_CHUNK_CLASS},
    {"struct", 6, CBERG_CHUNK_STRUCT},
    {"interface", 9, CBERG_CHUNK_INTERFACE},
    {"window", 6, CBERG_CHUNK_WINDOW},
    {"section", 7, CBERG_CHUNK_SECTION},
    {"key", 3, CBERG_CHUNK_KEY},
};

const char *cberg_chunk_kind_name(cberg_chunk_kind kind) {
    for (size_t i = 0; i < sizeof(k_kinds) / sizeof(k_kinds[0]); i++) {
        if (k_kinds[i].kind == kind) {
            return k_kinds[i].name;
        }
    }
    return "unknown";
}

int cberg_chunk_kind_parse(const char *s) {
    if (s == NULL || s[0] == '\0') {
        return -1;
    }
    for (size_t i = 0; i < sizeof(k_kinds) / sizeof(k_kinds[0]); i++) {
        if (strcasecmp(s, k_kinds[i].name) == 0) {
            return (int)k_kinds[i].kind;
        }
    }
    return -1;
}

cberg_chunk_kind cberg_chunk_kind_from_capture(const char *name, uint32_t len) {
    if (name == NULL) {
        return CBERG_CHUNK_UNKNOWN;
    }
    for (size_t i = 0; i < sizeof(k_kinds) / sizeof(k_kinds[0]); i++) {
        if (k_kinds[i].name_len == len && strncmp(name, k_kinds[i].name, len) == 0) {
            return k_kinds[i].kind;
        }
    }
    return CBERG_CHUNK_UNKNOWN;
}
