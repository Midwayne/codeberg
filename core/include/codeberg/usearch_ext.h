#ifndef CODEBERG_USEARCH_EXT_H
#define CODEBERG_USEARCH_EXT_H

#include "usearch.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Implemented in src/search/usearch_compact.cpp; not yet in upstream usearch.h. */
USEARCH_EXPORT void usearch_compact(usearch_index_t index, size_t threads, usearch_error_t *error);

#ifdef __cplusplus
}
#endif

#endif /* CODEBERG_USEARCH_EXT_H */
