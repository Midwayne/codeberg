#ifndef INDEX_PROVIDER_HARNESS_H
#define INDEX_PROVIDER_HARNESS_H

#include "codeberg/codeberg.h"

/*
 * Exercises add / search / upsert / remove / save / reopen / clear / wipe for
 * one vector index backend. `path` must be unique per run (collection/table
 * identity for remote providers; file path for usearch).
 * Returns the number of failed assertions (0 = success).
 */
int index_provider_harness_run(const char *label, const cberg_index_config *cfg, const char *path);

#endif /* INDEX_PROVIDER_HARNESS_H */
