/* Manifest diff: compares two trees top-down, pruning any directory whose
 * rollup hash is unchanged, so a localized edit costs O(changed files + path
 * depth) instead of O(all files). */
#include "codeberg/codeberg.h"

#include <stdlib.h>
#include <string.h>

#include "grow.h"
#include "manifest_internal.h"

typedef struct {
    const char **items;
    size_t len;
    size_t cap;
} path_list;

static cberg_status path_push(path_list *l, const char *path) {
    size_t cap = cberg_grow_cap(l->cap, l->len + 1, 16);
    if (cap != l->cap) {
        const char **grown = realloc(l->items, cap * sizeof(*grown));
        if (grown == NULL) {
            return CBERG_ERR_OUT_OF_MEMORY;
        }
        l->items = grown;
        l->cap = cap;
    }
    l->items[l->len++] = path;
    return CBERG_OK;
}

static cberg_status collect_files(const cberg_manifest *m, const manifest_node *node, path_list *out) {
    for (size_t i = 0; i < node->child_len; i++) {
        const manifest_child *ch = &node->children[i];
        cberg_status st;
        if (ch->is_dir) {
            st = collect_files(m, ch->u.dir, out);
        } else {
            st = path_push(out, m->entries[ch->u.leaf_index].path);
        }
        if (st != CBERG_OK) {
            return st;
        }
    }
    return CBERG_OK;
}

/* Adds every file under child (one file, or a whole subdirectory) to out. */
static cberg_status collect_child(const cberg_manifest *m, const manifest_child *ch, path_list *out) {
    if (ch->is_dir) {
        return collect_files(m, ch->u.dir, out);
    }
    return path_push(out, m->entries[ch->u.leaf_index].path);
}

/* The two sides of a diff and where its changed paths go. */
typedef struct {
    const cberg_manifest *prev;
    const cberg_manifest *next;
    path_list added;
    path_list modified;
    path_list deleted;
} diff_ctx;

static cberg_status diff_node(diff_ctx *d, const manifest_node *a, const manifest_node *b);

/* Compares two children with the same name. */
static cberg_status diff_same_name(diff_ctx *d, const manifest_child *ca, const manifest_child *cb) {
    if (ca->is_dir && cb->is_dir) {
        return diff_node(d, ca->u.dir, cb->u.dir);
    }

    if (!ca->is_dir && !cb->is_dir) {
        const uint8_t *before = d->prev->entries[ca->u.leaf_index].hash;
        const uint8_t *after = d->next->entries[cb->u.leaf_index].hash;
        if (memcmp(before, after, CBERG_HASH_LEN) == 0) {
            return CBERG_OK;
        }
        return path_push(&d->modified, d->next->entries[cb->u.leaf_index].path);
    }

    /* A file became a directory or the reverse: delete one, add the other. */
    cberg_status st = collect_child(d->prev, ca, &d->deleted);
    return st == CBERG_OK ? collect_child(d->next, cb, &d->added) : st;
}

/* Merges two directories' name-sorted children. */
static cberg_status diff_node(diff_ctx *d, const manifest_node *a, const manifest_node *b) {
    if (memcmp(a->hash, b->hash, CBERG_HASH_LEN) == 0) {
        return CBERG_OK;
    }

    size_t i = 0;
    size_t j = 0;
    cberg_status st = CBERG_OK;
    while (st == CBERG_OK && (i < a->child_len || j < b->child_len)) {
        const manifest_child *ca = i < a->child_len ? &a->children[i] : NULL;
        const manifest_child *cb = j < b->child_len ? &b->children[j] : NULL;
        int cmp = ca == NULL ? 1 : cb == NULL ? -1 : strcmp(ca->name, cb->name);

        if (cmp < 0) {
            st = collect_child(d->prev, ca, &d->deleted);
            i++;
        } else if (cmp > 0) {
            st = collect_child(d->next, cb, &d->added);
            j++;
        } else {
            st = diff_same_name(d, ca, cb);
            i++;
            j++;
        }
    }
    return st;
}

cberg_status cberg_manifest_diff(const cberg_manifest *prev, const cberg_manifest *next, cberg_manifest_changes *out_changes) {
    if (prev == NULL || next == NULL || out_changes == NULL) {
        return CBERG_ERR_INVALID_ARGUMENT;
    }
    memset(out_changes, 0, sizeof(*out_changes));

    diff_ctx d = {.prev = prev, .next = next};
    cberg_status st = diff_node(&d, prev->root, next->root);
    if (st != CBERG_OK) {
        free(d.added.items);
        free(d.modified.items);
        free(d.deleted.items);
        return st;
    }

    out_changes->added = d.added.items;
    out_changes->added_len = d.added.len;
    out_changes->modified = d.modified.items;
    out_changes->modified_len = d.modified.len;
    out_changes->deleted = d.deleted.items;
    out_changes->deleted_len = d.deleted.len;
    return CBERG_OK;
}

void cberg_manifest_diff_free(cberg_manifest_changes *changes) {
    if (changes == NULL) {
        return;
    }
    free((void *)changes->added);
    free((void *)changes->modified);
    free((void *)changes->deleted);
    memset(changes, 0, sizeof(*changes));
}
