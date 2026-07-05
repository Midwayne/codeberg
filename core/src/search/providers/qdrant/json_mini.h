#ifndef CBERG_QDRANT_JSON_MINI_H
#define CBERG_QDRANT_JSON_MINI_H

#include <stddef.h>
#include <stdint.h>

/*
 * Minimal JSON helpers for Qdrant REST responses. Not a general parser —
 * handles the object/array shapes Codeberg issues and consumes.
 */

/* Navigates dotted paths (e.g. "result.config.params.vectors") to a value start. */
const char *cberg_json_get_path(const char *root, const char *path);

/* Reads a JSON number at `p` (after optional whitespace). */
int cberg_json_read_int(const char *p, int *out);
int cberg_json_read_uint64(const char *p, uint64_t *out);
int cberg_json_read_double(const char *p, double *out);

/*
 * Parses Qdrant search / point-list payloads:
 * { "result": [ { "id": N, "score": F }, ... ] }
 */
int cberg_json_parse_qdrant_hits(const char *body, size_t k, uint64_t *out_ids, float *out_scores, size_t *out_found);

/* True when result is a non-empty array of point objects. */
int cberg_json_qdrant_points_nonempty(const char *body);

/* Reads collection vector size from GET /collections/{name} body. */
int cberg_json_qdrant_collection_dim(const char *body, int *out_dim);

#endif /* CBERG_QDRANT_JSON_MINI_H */
