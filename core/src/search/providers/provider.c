#include "provider.h"

#include <stdlib.h>

cberg_index_backend *cberg_index_backend_new(
    void *impl, void (*destroy)(void *), cberg_status (*add)(void *, uint64_t, const float *, size_t),
    cberg_status (*remove)(void *, uint64_t),
    cberg_status (*search)(void *, const float *, size_t, size_t, size_t, uint64_t *, float *, size_t *),
    cberg_status (*save)(void *), cberg_status (*clear)(void *)) {
    cberg_index_backend *backend = calloc(1, sizeof(*backend));
    if (backend == NULL) {
        return NULL;
    }
    backend->impl = impl;
    backend->destroy = destroy;
    backend->add = add;
    backend->remove = remove;
    backend->search = search;
    backend->save = save;
    backend->clear = clear;
    return backend;
}

void cberg_index_backend_close(cberg_index_backend *backend) {
    if (backend == NULL) {
        return;
    }
    if (backend->destroy != NULL) {
        backend->destroy(backend->impl);
    }
    free(backend);
}
