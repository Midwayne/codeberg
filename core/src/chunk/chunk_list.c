/* The chunk list every chunker fills, and the line-window fallback. */
#include "chunker_internal.h"

#include <stdlib.h>

#include "chunk_keys.h"
#include "grow.h"

#define CBERG_WINDOW_LINES 50

static cberg_status list_reserve(cberg_chunk_list *list, size_t want) {
    size_t cap = cberg_grow_cap(list->cap, want, 16);
    if (cap == list->cap) {
        return CBERG_OK;
    }
    cberg_chunk *items = realloc(list->items, cap * sizeof(cberg_chunk));
    if (items == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    list->items = items;
    list->cap = cap;
    return CBERG_OK;
}

cberg_status chunk_list_push(cberg_chunk_list *list, const char *path, cberg_chunk_kind kind, cberg_span span, const char *symbol_src, uint32_t symbol_start, uint32_t symbol_end, uint32_t occ) {
    cberg_status st = list_reserve(list, list->len + 1);
    if (st != CBERG_OK) {
        return st;
    }
    char *path_copy = cberg_arena_strdup(list->arena, path);
    char *symbol = NULL;
    if (symbol_src != NULL && symbol_end > symbol_start) {
        symbol = cberg_arena_dup(list->arena, symbol_src + symbol_start, symbol_end - symbol_start);
    }
    char key_buf[CBERG_CHUNK_KEY_MAX];
    st = chunk_format_key(key_buf, sizeof(key_buf), path, kind, symbol, occ);
    if (st != CBERG_OK) {
        return st;
    }
    char *key = cberg_arena_strdup(list->arena, key_buf);
    if (path_copy == NULL || key == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    list->items[list->len++] = (cberg_chunk){
        .key = key,
        .path = path_copy,
        .symbol = symbol,
        .kind = kind,
        .span = span,
    };
    return CBERG_OK;
}

cberg_chunk_list *chunk_list_new(void) {
    cberg_chunk_list *list = calloc(1, sizeof(cberg_chunk_list));
    if (list == NULL) {
        return NULL;
    }

    list->arena = cberg_arena_new();
    if (list->arena == NULL) {
        free(list);
        return NULL;
    }

    return list;
}

cberg_status chunk_windows(const char *path, const char *src, size_t src_len, cberg_chunk_list **out_list) {
    cberg_chunk_list *list = chunk_list_new();
    if (list == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }

    uint32_t win_start_byte = 0;
    uint32_t win_start_line = 1;
    uint32_t line = 1;
    uint32_t lines_in_window = 0;
    uint32_t occ = 0;

    for (size_t i = 0; i < src_len; i++) {
        if (src[i] == '\n') {
            line++;
            lines_in_window++;
            if (lines_in_window >= CBERG_WINDOW_LINES) {
                cberg_span span = {
                    .start_byte = win_start_byte,
                    .end_byte = (uint32_t)(i + 1),
                    .start_line = win_start_line,
                    .end_line = line - 1,
                };
                cberg_status st = chunk_list_push(list, path, CBERG_CHUNK_WINDOW, span, NULL, 0, 0, occ++);
                if (st != CBERG_OK) {
                    cberg_chunk_list_free(list);
                    return st;
                }
                win_start_byte = (uint32_t)(i + 1);
                win_start_line = line;
                lines_in_window = 0;
            }
        }
    }
    if (win_start_byte < src_len) {
        cberg_span span = {
            .start_byte = win_start_byte,
            .end_byte = (uint32_t)src_len,
            .start_line = win_start_line,
            .end_line = line,
        };
        cberg_status st = chunk_list_push(list, path, CBERG_CHUNK_WINDOW, span, NULL, 0, 0, occ);
        if (st != CBERG_OK) {
            cberg_chunk_list_free(list);
            return st;
        }
    }
    *out_list = list;
    return CBERG_OK;
}

size_t cberg_chunk_list_len(const cberg_chunk_list *list) {
    return list == NULL ? 0 : list->len;
}

const cberg_chunk *cberg_chunk_list_at(const cberg_chunk_list *list, size_t index) {
    if (list == NULL || index >= list->len) {
        return NULL;
    }
    return &list->items[index];
}

void cberg_chunk_list_free(cberg_chunk_list *list) {
    if (list == NULL) {
        return;
    }
    cberg_arena_free(list->arena);
    free(list->items);
    free(list);
}

cberg_status cberg_chunk_list_hash_bodies(const cberg_chunk_list *list, const char *src, size_t src_len) {
    if (list == NULL || src == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    for (size_t i = 0; i < list->len; i++) {
        cberg_chunk *c = &list->items[i];
        if (c->span.end_byte > src_len || c->span.start_byte > c->span.end_byte) {
            return CBERG_ERR_INVALID_ARGUMENT;
        }
        cberg_status st =
            cberg_hash(src + c->span.start_byte, c->span.end_byte - c->span.start_byte, c->content_hash);
        if (st != CBERG_OK) {
            return st;
        }
    }
    return CBERG_OK;
}
