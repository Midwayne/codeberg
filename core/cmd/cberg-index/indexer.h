#ifndef CBERG_INDEXER_H
#define CBERG_INDEXER_H

#include <pthread.h>
#include <stddef.h>
#include <stdint.h>

#include "codeberg/codeberg.h"

typedef struct cberg_indexer {
    char *root;
    char *model_path;
    char *index_path;
    char *socket_path;
    int poll_ms;
    int vectors;

    cberg_chunker *chunker;
    cberg_chunk_table *table;
    cberg_watcher *watcher;
    cberg_embedder *embedder;
    cberg_index *index;

    pthread_mutex_t mu;
    int ready;
    int stop;
} cberg_indexer;

cberg_status cberg_indexer_open(cberg_indexer *idx);
void cberg_indexer_close(cberg_indexer *idx);

cberg_status cberg_indexer_bootstrap(cberg_indexer *idx);
cberg_status cberg_indexer_run(cberg_indexer *idx);

cberg_status cberg_indexer_search(cberg_indexer *idx, const char *query, size_t k, uint64_t *ids, float *scores,
                                  size_t *found);

size_t cberg_indexer_chunk_count(cberg_indexer *idx);
const char *cberg_indexer_version(void);

#endif
