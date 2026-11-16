/* Fragment building: definitions from symbol chunks, CONTAINS edges from
 * span nesting, and the reference list the reference walk appends to. */
#include "codeberg/codeberg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <tree_sitter/api.h>

#include "arena.h"
#include "graph_extract.h"
#include "grow.h"


cberg_graph_fragment *graph_fragment_new(const char *path, cberg_language lang) {
    cberg_graph_fragment *frag = calloc(1, sizeof(*frag));
    if (frag == NULL) {
        return NULL;
    }
    frag->arena = cberg_arena_new();
    if (frag->arena == NULL) {
        free(frag);
        return NULL;
    }
    frag->path = cberg_arena_strdup(frag->arena, path);
    if (frag->path == NULL) {
        cberg_graph_fragment_free(frag);
        return NULL;
    }
    frag->lang = lang;
    return frag;
}

const char *cberg_graph_fragment_path(const cberg_graph_fragment *fragment) {
    return fragment == NULL ? NULL : fragment->path;
}

void cberg_graph_fragment_free(cberg_graph_fragment *fragment) {
    if (fragment == NULL) {
        return;
    }
    cberg_arena_free(fragment->arena);
    free(fragment->defs);
    free(fragment->refs);
    free(fragment);
}

static cberg_status fragment_push_def(cberg_graph_fragment *frag, const cberg_chunk *chunk) {
    size_t cap = cberg_grow_cap(frag->defs_cap, frag->defs_len + 1, 16);
    if (cap != frag->defs_cap) {
        cberg_graph_fdef *grown = realloc(frag->defs, cap * sizeof(*grown));
        if (grown == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        frag->defs = grown;
        frag->defs_cap = cap;
    }
    const char *key = cberg_arena_strdup(frag->arena, chunk->key);
    const char *name = cberg_arena_strdup(frag->arena, chunk->symbol);
    if (key == NULL || name == NULL) {
        return CBERG_ERR_OUT_OF_MEMORY;
    }
    frag->defs[frag->defs_len++] = (cberg_graph_fdef){
        .key = key,
        .name = name,
        .kind = chunk->kind,
        .span = chunk->span,
    };
    return CBERG_OK;
}

cberg_status graph_fragment_push_ref(cberg_graph_fragment *frag, int32_t src_def, int32_t dst_def, const char *name, uint32_t line, uint8_t kind, uint8_t rev) {
    size_t cap = cberg_grow_cap(frag->refs_cap, frag->refs_len + 1, 32);
    if (cap != frag->refs_cap) {
        cberg_graph_fref *grown = realloc(frag->refs, cap * sizeof(*grown));
        if (grown == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        frag->refs = grown;
        frag->refs_cap = cap;
    }
    const char *name_copy = NULL;
    if (name != NULL) {
        name_copy = cberg_arena_strdup(frag->arena, name);
        if (name_copy == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
    }
    frag->refs[frag->refs_len++] = (cberg_graph_fref){
        .src_def = src_def,
        .dst_def = dst_def,
        .name = name_copy,
        .line = line,
        .kind = kind,
        .rev = rev,
    };
    return CBERG_OK;
}

static int def_is_symbol(cberg_chunk_kind kind) {
    switch (kind) {
    case CBERG_CHUNK_FUNCTION:
    case CBERG_CHUNK_METHOD:
    case CBERG_CHUNK_CLASS:
    case CBERG_CHUNK_STRUCT:
    case CBERG_CHUNK_INTERFACE:
        return 1;
    default:
        return 0;
    }
}

static int def_is_container(cberg_chunk_kind kind) {
    return kind == CBERG_CHUNK_CLASS || kind == CBERG_CHUNK_STRUCT || kind == CBERG_CHUNK_INTERFACE;
}

/* Smallest definition whose span contains byte `pos`, or -1 (file scope). */
int32_t graph_fragment_enclosing_def(const cberg_graph_fragment *frag, uint32_t pos) {
    int32_t best = -1;
    uint32_t best_size = UINT32_MAX;
    for (size_t i = 0; i < frag->defs_len; i++) {
        const cberg_span *s = &frag->defs[i].span;
        if (s->start_byte <= pos && pos < s->end_byte && s->end_byte - s->start_byte < best_size) {
            best = (int32_t)i;
            best_size = s->end_byte - s->start_byte;
        }
    }
    return best;
}

/* CONTAINS from chunk nesting: link each definition to its smallest strictly
 * enclosing container definition (nested classes, methods in class bodies). */
static cberg_status fragment_add_nesting(cberg_graph_fragment *frag) {
    for (size_t i = 0; i < frag->defs_len; i++) {
        const cberg_span *child = &frag->defs[i].span;
        int32_t parent = -1;
        uint32_t parent_size = UINT32_MAX;
        for (size_t j = 0; j < frag->defs_len; j++) {
            if (i == j || !def_is_container(frag->defs[j].kind)) {
                continue;
            }
            const cberg_span *outer = &frag->defs[j].span;
            uint32_t size = outer->end_byte - outer->start_byte;
            if (outer->start_byte <= child->start_byte && child->end_byte <= outer->end_byte &&
                size > child->end_byte - child->start_byte && size < parent_size) {
                parent = (int32_t)j;
                parent_size = size;
            }
        }
        if (parent >= 0) {
            cberg_status st = graph_fragment_push_ref(frag, parent, (int32_t)i, NULL, child->start_line, CBERG_GEDGE_CONTAINS, 0);
            if (st != CBERG_OK) {
                return st;
            }
        }
    }
    return CBERG_OK;
}

/* Adds a definition per symbol chunk, then the CONTAINS edges implied by
 * their span nesting. */
cberg_status graph_fragment_add_defs(cberg_graph_fragment *frag, const cberg_chunk_list *chunks) {
    cberg_status st = CBERG_OK;
    size_t n = cberg_chunk_list_len(chunks);

    for (size_t i = 0; i < n && st == CBERG_OK; i++) {
        const cberg_chunk *chunk = cberg_chunk_list_at(chunks, i);
        if (def_is_symbol(chunk->kind) && chunk->symbol != NULL) {
            st = fragment_push_def(frag, chunk);
        }
    }

    return st == CBERG_OK ? fragment_add_nesting(frag) : st;
}
