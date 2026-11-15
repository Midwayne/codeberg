#include <stdlib.h>

#include "grow.h"
#include "scope_internal.h"
#include "u64map.h"

/*
 * Per-file memo of the declarations each lexical scope owns directly.
 *
 * Binding a reference asks every enclosing scope "which declaration of this
 * name is nearest?". Answering by re-walking the scope's subtree makes one
 * file cost references x nodes, which stalls on large generated sources.
 * Each scope is walked once here instead; lookups scan only its declarations.
 */

typedef struct scope_span {
    size_t offset;
    size_t count;
} scope_span;

struct cberg_graph_scope_cache {
    cberg_u64map *scopes; /* scope node id -> index into spans, plus one */
    scope_span *spans;
    size_t spans_len;
    size_t spans_cap;
    graph_declaration *items; /* owned; spans index into it */
    size_t items_len;
    size_t items_cap;
    unsigned char *parameter_lists; /* per depth: is the parent a parameter list */
    size_t depth_cap;
    TSNode *imports; /* the root's import statements, in source order */
    size_t imports_len;
    size_t imports_cap;
    int imports_state; /* 0 = not collected, 1 = collected, -1 = unavailable */
};

cberg_graph_scope_cache *cberg_graph_scope_cache_new(void) {
    cberg_graph_scope_cache *cache = calloc(1, sizeof *cache);
    if (cache == NULL)
        return NULL;

    cache->scopes = cberg_u64map_new(64);
    if (cache->scopes == NULL) {
        free(cache);
        return NULL;
    }

    return cache;
}

void cberg_graph_scope_cache_free(cberg_graph_scope_cache *cache) {
    if (cache == NULL)
        return;

    cberg_u64map_free(cache->scopes);
    free(cache->spans);
    free(cache->items);
    free(cache->parameter_lists);
    free(cache->imports);
    free(cache);
}

static int push_declaration(cberg_graph_scope_cache *cache, TSNode node, int parameter) {
    if (cache->items_len == cache->items_cap) {
        size_t cap = cberg_grow_cap(cache->items_cap, cache->items_len + 1, 64);
        graph_declaration *items = realloc(cache->items, cap * sizeof *items);
        if (items == NULL)
            return 0;

        cache->items = items;
        cache->items_cap = cap;
    }

    cache->items[cache->items_len++] = (graph_declaration){.node = node, .parameter = parameter};
    return 1;
}

static int mark_depth(cberg_graph_scope_cache *cache, size_t depth, TSNode parent) {
    if (depth >= cache->depth_cap) {
        size_t cap = cberg_grow_cap(cache->depth_cap, depth + 1, 64);
        unsigned char *flags = realloc(cache->parameter_lists, cap);
        if (flags == NULL)
            return 0;

        cache->parameter_lists = flags;
        cache->depth_cap = cap;
    }

    cache->parameter_lists[depth] = graph_is(parent, "formal_parameters") || graph_is(parent, "parameters");
    return 1;
}

/* Nested scopes own their declarations; anonymous tokens declare nothing. */
static int searchable(TSNode node) {
    return ts_node_is_named(node) && !graph_scope_node(node);
}

static int visit(cberg_graph_scope_cache *cache, TSNode node, size_t depth) {
    if (!searchable(node))
        return 1;

    int parameter = graph_is(node, "identifier") && cache->parameter_lists[depth];
    if (!parameter && !graph_declaration_node(node))
        return 1;

    return push_declaration(cache, node, parameter);
}

/* Post-order over the scope's own nodes; reversed, it is the lookup order. */
static int collect(cberg_graph_scope_cache *cache, TSNode scope) {
    TSTreeCursor cursor = ts_tree_cursor_new(scope);
    size_t depth = 0;
    int ok = mark_depth(cache, 0, scope);
    int more = ok && ts_tree_cursor_goto_first_child(&cursor);

    while (ok && more) {
        TSNode node = ts_tree_cursor_current_node(&cursor);
        if (searchable(node) && ts_tree_cursor_goto_first_child(&cursor)) {
            ok = mark_depth(cache, ++depth, node);
            continue;
        }

        /* Finished this subtree: emit it, then each parent whose children ran out. */
        for (;;) {
            ok = visit(cache, ts_tree_cursor_current_node(&cursor), depth);
            if (!ok || ts_tree_cursor_goto_next_sibling(&cursor))
                break;

            if (depth == 0 || !ts_tree_cursor_goto_parent(&cursor)) {
                more = 0;
                break;
            }

            depth--;
        }
    }

    ts_tree_cursor_delete(&cursor);
    return ok;
}

static void reverse(graph_declaration *items, size_t count) {
    for (size_t i = 0; i < count / 2; i++) {
        graph_declaration swap = items[i];
        items[i] = items[count - 1 - i];
        items[count - 1 - i] = swap;
    }
}

static int remember(cberg_graph_scope_cache *cache, TSNode scope, size_t offset) {
    if (cache->spans_len == cache->spans_cap) {
        size_t cap = cberg_grow_cap(cache->spans_cap, cache->spans_len + 1, 16);
        scope_span *spans = realloc(cache->spans, cap * sizeof *spans);
        if (spans == NULL)
            return 0;

        cache->spans = spans;
        cache->spans_cap = cap;
    }

    cache->spans[cache->spans_len] = (scope_span){.offset = offset, .count = cache->items_len - offset};
    if (cberg_u64map_set(cache->scopes, (uint64_t)(uintptr_t)scope.id, cache->spans_len + 1) != CBERG_OK)
        return 0;

    cache->spans_len++;
    return 1;
}

int graph_scope_declarations(cberg_graph_scope_cache *cache, TSNode scope, const graph_declaration **out, size_t *count) {
    if (cache == NULL || scope.id == NULL)
        return 0;

    uint64_t slot = 0;
    if (!cberg_u64map_get(cache->scopes, (uint64_t)(uintptr_t)scope.id, &slot)) {
        size_t offset = cache->items_len;
        if (!collect(cache, scope) || !remember(cache, scope, offset)) {
            /* Leave no partial span behind; the caller falls back to a walk. */
            cache->items_len = offset;
            return 0;
        }

        reverse(cache->items + offset, cache->items_len - offset);
        slot = cache->spans_len;
    }

    const scope_span *span = &cache->spans[slot - 1];
    *out = cache->items + span->offset;
    *count = span->count;
    return 1;
}

static int push_import(cberg_graph_scope_cache *cache, TSNode node) {
    if (cache->imports_len == cache->imports_cap) {
        size_t cap = cberg_grow_cap(cache->imports_cap, cache->imports_len + 1, 16);
        TSNode *imports = realloc(cache->imports, cap * sizeof *imports);
        if (imports == NULL)
            return 0;

        cache->imports = imports;
        cache->imports_cap = cap;
    }

    cache->imports[cache->imports_len++] = node;
    return 1;
}

static int collect_imports(cberg_graph_scope_cache *cache, TSNode root) {
    TSTreeCursor cursor = ts_tree_cursor_new(root);
    int ok = 1;

    for (int more = ts_tree_cursor_goto_first_child(&cursor); ok && more; more = ts_tree_cursor_goto_next_sibling(&cursor)) {
        TSNode node = ts_tree_cursor_current_node(&cursor);
        if (ts_node_is_named(node) && graph_import_node(node))
            ok = push_import(cache, node);
    }

    ts_tree_cursor_delete(&cursor);
    return ok;
}

int graph_root_imports(cberg_graph_scope_cache *cache, TSNode root, const TSNode **out, size_t *count) {
    if (cache == NULL || cache->imports_state < 0)
        return 0;

    if (cache->imports_state == 0) {
        cache->imports_state = collect_imports(cache, root) ? 1 : -1;
        if (cache->imports_state < 0)
            return 0;
    }

    *out = cache->imports;
    *count = cache->imports_len;
    return 1;
}
