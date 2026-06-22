#include "codeberg/codeberg.h"

#ifndef CBERG_VERSION
#define CBERG_VERSION "dev"
#endif

const char *cberg_version(void) {
    return CBERG_VERSION;
}
