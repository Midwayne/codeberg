#include "indexer_internal.h"

#include "chunk_table_internal.h"
#include "grow.h"

#include <stdint.h>
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

/* Grow *items (elements of `size` bytes) to hold at least `want` of them. */
static cberg_status reserve(void **items, size_t *cap, size_t want, size_t initial, size_t size) {
    if (want <= *cap) {
        return CBERG_OK;
    }

    size_t next_cap = cberg_grow_cap(*cap, want, initial);
    if (next_cap > SIZE_MAX / size) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    void *grown = realloc(*items, next_cap * size);
    if (grown == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    *items = grown;
    *cap = next_cap;
    return CBERG_OK;
}

static cberg_status reserve_chunks(chunk_batch *b, size_t extra) {
    return reserve((void **)&b->items, &b->cap, b->len + extra, 64, sizeof(*b->items));
}

static cberg_status add_fragment(chunk_batch *b, cberg_graph_fragment *frag) {
    if (frag == NULL) {
        return CBERG_OK;
    }

    cberg_status st = reserve((void **)&b->frags, &b->frags_cap, b->frags_len + 1, 16, sizeof(*b->frags));
    if (st != CBERG_OK) {
        return st;
    }

    b->frags[b->frags_len++] = frag;
    return CBERG_OK;
}

static cberg_status add_list(chunk_batch *b, cberg_chunk_list *list) {
    if (list == NULL) {
        return CBERG_OK;
    }

    size_t n = cberg_chunk_list_len(list);
    cberg_status st = reserve_chunks(b, n);
    if (st == CBERG_OK) {
        st = reserve((void **)&b->lists, &b->lists_cap, b->lists_len + 1, 16, sizeof(*b->lists));
    }
    if (st != CBERG_OK) {
        return st;
    }

    for (size_t i = 0; i < n; i++) {
        b->items[b->len++] = *cberg_chunk_list_at(list, i);
    }
    b->lists[b->lists_len++] = list;
    return CBERG_OK;
}

cberg_status chunk_batch_add_file(chunk_batch *b, cberg_chunk_list *list, cberg_graph_fragment *frag) {
    if (list == NULL) {
        cberg_graph_fragment_free(frag);
        return CBERG_OK;
    }

    cberg_status st = add_list(b, list);
    if (st != CBERG_OK) {
        cberg_chunk_list_free(list);
        cberg_graph_fragment_free(frag);
        return st;
    }

    st = add_fragment(b, frag);
    if (st != CBERG_OK) {
        cberg_graph_fragment_free(frag);
    }
    return st;
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
        if (sc == NULL || path_in_set(sc->chunk.path, skip, skip_n)) {
            continue;
        }

        cberg_status st = reserve_chunks(batch, 1);
        if (st != CBERG_OK) {
            return st;
        }
        batch->items[batch->len++] = sc->chunk;
    }
    return CBERG_OK;
}
