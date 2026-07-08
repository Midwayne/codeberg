#ifndef INDEX_PROVIDER_HARNESS_H
#define INDEX_PROVIDER_HARNESS_H

#include <stddef.h>

#include "codeberg/codeberg.h"

/*
 * Exercises add / search / upsert / remove / save / reopen / clear / wipe for
 * one vector index backend. `path` must be unique per run (collection/table
 * identity for remote providers; file path for usearch).
 * Returns the number of failed assertions (0 = success).
 */
int index_provider_harness_run(const char *test_label, const cberg_index_config *cfg, const char *path, size_t dim);

/* usearch only: reads live efSearch from the underlying index (for tests). */
cberg_status cberg_usearch_index_active_expansion(const cberg_index *index, size_t *out);

/* usearch only: reads the active stored scalar kind (for tests). */
cberg_status cberg_usearch_index_stored_quant(const cberg_index *index, cberg_index_quant *out);

/* Verifies usearch restores default expansion_search after a high-ef query. */
int index_provider_test_usearch_expansion_restore(void);

void test_temp_path(char *path, size_t cap, const char *template);
char *test_unique_path(const char *prefix);

#endif /* INDEX_PROVIDER_HARNESS_H */
