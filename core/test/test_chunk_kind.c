#include "chunk_kind.h"

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
    CHECK(strcmp(cberg_chunk_kind_name(CBERG_CHUNK_FUNCTION), "function") == 0, "function name");
    CHECK(strcmp(cberg_chunk_kind_name(CBERG_CHUNK_KEY), "key") == 0, "key name");
    CHECK(strcmp(cberg_chunk_kind_name(CBERG_CHUNK_UNKNOWN), "unknown") == 0, "unknown name");
    CHECK(strcmp(cberg_chunk_kind_name((cberg_chunk_kind)999), "unknown") == 0, "bogus name");

    CHECK(cberg_chunk_kind_parse(NULL) == -1, "parse null");
    CHECK(cberg_chunk_kind_parse("") == -1, "parse empty");
    CHECK(cberg_chunk_kind_parse("nope") == -1, "parse unknown");
    CHECK(cberg_chunk_kind_parse("function") == CBERG_CHUNK_FUNCTION, "parse function");
    CHECK(cberg_chunk_kind_parse("KEY") == CBERG_CHUNK_KEY, "parse key case");
    CHECK(cberg_chunk_kind_parse("Section") == CBERG_CHUNK_SECTION, "parse section case");

    CHECK(cberg_chunk_kind_from_capture("method", 6) == CBERG_CHUNK_METHOD, "capture method");
    CHECK(cberg_chunk_kind_from_capture("methodish", 6) == CBERG_CHUNK_METHOD, "capture prefix len");
    CHECK(cberg_chunk_kind_from_capture("method", 5) == CBERG_CHUNK_UNKNOWN, "capture short");
    CHECK(cberg_chunk_kind_from_capture(NULL, 0) == CBERG_CHUNK_UNKNOWN, "capture null");
    CHECK(cberg_chunk_kind_from_capture("window", 6) == CBERG_CHUNK_WINDOW, "capture window");

    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    return 0;
}
