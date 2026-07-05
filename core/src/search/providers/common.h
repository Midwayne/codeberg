#ifndef CBERG_SEARCH_PROVIDER_COMMON_H
#define CBERG_SEARCH_PROVIDER_COMMON_H

#include <stddef.h>

/* Stable per-index identity: codeberg_<16 hex> from hashing `path`. */
char *cberg_provider_name_from_path(const char *path);

/* pgvector literal: [f1,f2,...] */
char *cberg_provider_vector_literal(const float *vector, size_t dim);

#endif /* CBERG_SEARCH_PROVIDER_COMMON_H */
