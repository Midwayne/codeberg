#ifndef CBERG_CHUNK_TABLE_INTERNAL_H
#define CBERG_CHUNK_TABLE_INTERNAL_H

#include "codeberg/codeberg.h"

/* Frees the change lists from the last sync early. Any cberg_changes obtained
 * from that sync is invalid afterwards; call it once the caller has finished
 * applying them (a cold sync's added list is one row per chunk, otherwise
 * held until the next sync). */
void cberg_chunk_table_release_changes(cberg_chunk_table *table);

#endif /* CBERG_CHUNK_TABLE_INTERNAL_H */
