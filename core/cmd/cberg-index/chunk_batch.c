#include "indexer_internal.h"

#include "chunk_table_internal.h"

#include <stdlib.h>
#include <string.h>

void chunk_batch_init(chunk_batch *b) {
    memset(b, 0, sizeof(*b));
}

static void batch_clear_lists(chunk_batch *b) {
    for (size_t i = 0; i < b->lists_len; i++) {
        cberg_chunk_list_free(b->lists[i]);
    }
    free(b->lists);
    b->lists = NULL;
    b->lists_len = 0;
    b->lists_cap = 0;
}

void chunk_batch_reset(chunk_batch *b) {
    free(b->items);
    b->items = NULL;
    b->len = 0;
    b->cap = 0;
    batch_clear_lists(b);
    for (size_t i = 0; i < b->frags_len; i++) {
        cberg_graph_fragment_free(b->frags[i]);
    }
    free(b->frags);
    b->frags = NULL;
    b->frags_len = 0;
    b->frags_cap = 0;
}

cberg_status chunk_batch_add_fragment(chunk_batch *b, cberg_graph_fragment *frag) {
    if (frag == NULL) {
        return CBERG_OK;
    }
    if (b->frags_len + 1 > b->frags_cap) {
        size_t new_cap = b->frags_cap == 0 ? 16 : b->frags_cap * 2;
        cberg_graph_fragment **next = realloc(b->frags, new_cap * sizeof(*b->frags));
        if (next == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        b->frags = next;
        b->frags_cap = new_cap;
    }
    b->frags[b->frags_len++] = frag;
    return CBERG_OK;
}

cberg_status chunk_batch_add_list(chunk_batch *b, cberg_chunk_list *list) {
    if (list == NULL) {
        return CBERG_OK;
    }
    size_t n = cberg_chunk_list_len(list);
    if (b->len + n > b->cap) {
        size_t new_cap = b->cap == 0 ? 64 : b->cap * 2;
        while (new_cap < b->len + n) {
            new_cap *= 2;
        }
        cberg_chunk *next = realloc(b->items, new_cap * sizeof(cberg_chunk));
        if (next == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        b->items = next;
        b->cap = new_cap;
    }
    for (size_t i = 0; i < n; i++) {
        b->items[b->len++] = *cberg_chunk_list_at(list, i);
    }
    if (b->lists_len + 1 > b->lists_cap) {
        size_t new_cap = b->lists_cap == 0 ? 16 : b->lists_cap * 2;
        cberg_chunk_list **next = realloc(b->lists, new_cap * sizeof(*b->lists));
        if (next == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        b->lists = next;
        b->lists_cap = new_cap;
    }
    b->lists[b->lists_len++] = list;
    return CBERG_OK;
}

static int path_in_set(const char *path, char **paths, size_t count) {
    for (size_t i = 0; i < count; i++) {
        if (strcmp(path, paths[i]) == 0) {
            return 1;
        }
    }
    return 0;
}

cberg_status chunk_batch_add_table_except(cberg_repo *r, chunk_batch *batch, char **skip, size_t skip_n) {
    size_t n = cberg_chunk_table_len(r->table);
    for (size_t i = 0; i < n; i++) {
        const cberg_stored_chunk *sc = cberg_chunk_table_at(r->table, i);
        if (sc == NULL) {
            continue;
        }
        if (path_in_set(sc->chunk.path, skip, skip_n)) {
            continue;
        }
        if (batch->len + 1 > batch->cap) {
            size_t new_cap = batch->cap == 0 ? 64 : batch->cap * 2;
            cberg_chunk *next = realloc(batch->items, new_cap * sizeof(cberg_chunk));
            if (next == NULL) {
                return CBERG_ERR_OUT_OF_MEMORY;
            }
            batch->items = next;
            batch->cap = new_cap;
        }
        batch->items[batch->len++] = sc->chunk;
    }
    return CBERG_OK;
}
