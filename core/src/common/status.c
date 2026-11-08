#include "codeberg/codeberg.h"

typedef struct cberg_status_info {
    const char *text;
    const char *code;
} cberg_status_info;

/* English text and the IPC machine code for one status. Keep them together. */
static const cberg_status_info STATUS_INFO[] = {
    [CBERG_OK] = {"ok", "ok"},
    [CBERG_ERR_INVALID_ARGUMENT] = {"invalid argument", "invalid_argument"},
    [CBERG_ERR_INTERNAL] = {"internal error", "internal_error"},
    [CBERG_ERR_IO] = {"I/O error", "io_error"},
    [CBERG_ERR_UNSUPPORTED_LANGUAGE] = {"unsupported language", "unsupported_language"},
    [CBERG_ERR_NOT_FOUND] = {"not found", "not_found"},
    [CBERG_ERR_OUT_OF_MEMORY] = {"out of memory", "out_of_memory"},
    [CBERG_ERR_TIMEOUT] = {"timeout", "timeout"},
    [CBERG_ERR_NOT_IMPLEMENTED] = {"not implemented", "not_implemented"},
    [CBERG_ERR_CORRUPT] = {"corrupt or incompatible index", "corrupt"},
};

static const cberg_status_info *status_info(cberg_status status) {
    if (status < 0 || (size_t)status >= sizeof(STATUS_INFO) / sizeof(STATUS_INFO[0])) {
        return NULL;
    }
    if (STATUS_INFO[status].text == NULL || STATUS_INFO[status].code == NULL) {
        return NULL;
    }
    return &STATUS_INFO[status];
}

const char *cberg_status_str(cberg_status status) {
    const cberg_status_info *info = status_info(status);
    return info != NULL ? info->text : "unknown error";
}

const char *cberg_status_code(cberg_status status) {
    const cberg_status_info *info = status_info(status);
    return info != NULL ? info->code : "internal_error";
}
