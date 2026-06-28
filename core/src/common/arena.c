#include "arena.h"

#include <stdlib.h>
#include <string.h>

#define CBERG_ARENA_BLOCK 65536

typedef struct cberg_arena_block {
    struct cberg_arena_block *next;
    size_t cap;
    size_t used;
    uint8_t data[];
} cberg_arena_block;

struct cberg_arena {
    cberg_arena_block *head;
};

cberg_arena *cberg_arena_new(void) {
    return calloc(1, sizeof(cberg_arena));
}

static cberg_arena_block *arena_block_new(size_t cap) {
    cberg_arena_block *block = malloc(sizeof(cberg_arena_block) + cap);
    if (block == NULL) {
        return NULL;
    }
    block->next = NULL;
    block->cap = cap;
    block->used = 0;
    return block;
}

void cberg_arena_free(cberg_arena *arena) {
    if (arena == NULL) {
        return;
    }
    cberg_arena_block *block = arena->head;
    while (block != NULL) {
        cberg_arena_block *next = block->next;
        free(block);
        block = next;
    }
    free(arena);
}

void cberg_arena_reset(cberg_arena *arena) {
    if (arena == NULL) {
        return;
    }
    cberg_arena_block *block = arena->head;
    while (block != NULL) {
        block->used = 0;
        block = block->next;
    }
}

static void *arena_alloc(cberg_arena *arena, size_t size, size_t align) {
    size_t pad = (align - 1);
    cberg_arena_block *block = arena->head;
    if (block == NULL || block->used + size + pad > block->cap) {
        size_t cap = CBERG_ARENA_BLOCK;
        if (size + pad > cap) {
            cap = size + pad;
        }
        cberg_arena_block *fresh = arena_block_new(cap);
        if (fresh == NULL) {
            return NULL;
        }
        fresh->next = arena->head;
        arena->head = fresh;
        block = fresh;
    }
    size_t aligned = (block->used + pad) & ~pad;
    if (aligned + size > block->cap) {
        return arena_alloc(arena, size, align);
    }
    void *out = block->data + aligned;
    block->used = aligned + size;
    return out;
}

void *cberg_arena_alloc(cberg_arena *arena, size_t size) {
    if (arena == NULL) {
        return NULL;
    }
    return arena_alloc(arena, size, 8);
}

char *cberg_arena_dup(cberg_arena *arena, const char *src, size_t len) {
    if (arena == NULL || src == NULL) {
        return NULL;
    }
    /* Strings have no alignment requirement; pack them at byte granularity so
     * keys/paths/symbols and manifest node names sit densely in cache lines
     * (the rollup and strcmp passes read them back-to-back) instead of wasting
     * up to 7 padding bytes each. Struct allocations still go through
     * cberg_arena_alloc at 8-byte alignment. */
    char *out = arena_alloc(arena, len + 1, 1);
    if (out == NULL) {
        return NULL;
    }
    memcpy(out, src, len);
    out[len] = '\0';
    return out;
}

char *cberg_arena_strdup(cberg_arena *arena, const char *src) {
    if (src == NULL) {
        return NULL;
    }
    return cberg_arena_dup(arena, src, strlen(src));
}
