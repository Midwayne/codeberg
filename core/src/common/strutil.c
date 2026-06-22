#include "strutil.h"

#include <stdlib.h>
#include <string.h>

char *cberg_strdup(const char *s) {
    if (s == NULL) {
        return NULL;
    }
    size_t n = strlen(s);
    char *out = malloc(n + 1);
    if (out == NULL) {
        return NULL;
    }
    memcpy(out, s, n + 1);
    return out;
}
