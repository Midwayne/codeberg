#ifndef CBERG_QDRANT_JSON_MINI_H
#define CBERG_QDRANT_JSON_MINI_H

#include <stddef.h>
#include <stdint.h>

/* Qdrant REST response shapes, read with json_read.h. */

/*
 * Parses Qdrant search / point-list payloads:
 * { "result": [ { "id": N, "score": F }, ... ] }
 */
int cberg_json_parse_qdrant_hits(const char *body, size_t k, uint64_t *out_ids, float *out_scores, size_t *out_found);

/* Reads collection vector size from GET /collections/{name} body. */
int cberg_json_qdrant_collection_dim(const char *body, int *out_dim);

#endif /* CBERG_QDRANT_JSON_MINI_H */
