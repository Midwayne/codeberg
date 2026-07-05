#ifndef CODEBERG_TEST_COMMON_H
#define CODEBERG_TEST_COMMON_H

#include <stdio.h>

static int failures;

#define CHECK(cond, msg)                                                    \
    do {                                                                    \
        if (!(cond)) {                                                      \
            fprintf(stderr, "FAIL: %s (%s:%d)\n", msg, __FILE__, __LINE__); \
            failures++;                                                     \
        }                                                                   \
    } while (0)

#define TEST_MAIN_RETURN return failures == 0 ? 0 : 1;

#endif
