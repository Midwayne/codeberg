#include "codeberg/codeberg.h"

static const char *const STATUS_STRINGS[] = {
    [CBERG_OK] = "ok",
    [CBERG_ERR_INVALID_ARGUMENT] = "invalid argument",
    [CBERG_ERR_INTERNAL] = "internal error",
    [CBERG_ERR_IO] = "I/O error",
    [CBERG_ERR_UNSUPPORTED_LANGUAGE] = "unsupported language",
    [CBERG_ERR_NOT_FOUND] = "not found",
    [CBERG_ERR_OUT_OF_MEMORY] = "out of memory",
    [CBERG_ERR_TIMEOUT] = "timeout",
    [CBERG_ERR_NOT_IMPLEMENTED] = "not implemented",
};

const char *cberg_status_str(cberg_status status) {
    if (status >= 0 && (size_t)status < sizeof(STATUS_STRINGS) / sizeof(STATUS_STRINGS[0]) &&
        STATUS_STRINGS[status] != NULL) {
        return STATUS_STRINGS[status];
    }
    return "unknown error";
}
