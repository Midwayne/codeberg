#ifndef CBERG_GRAPH_SCOPE_INTERNAL_H
#define CBERG_GRAPH_SCOPE_INTERNAL_H

#include "graph_internal.h"

typedef struct graph_syntax {
    const cberg_graph_fragment *fragment;
    TSNode root;
    const char *source;
    size_t length;
    cberg_graph_scope_cache *cache; /* borrowed; NULL walks scopes directly */
} graph_syntax;

/* A node that can declare a value. `parameter` marks a bare identifier whose
 * parent is a parameter list, which the cache records while it walks. */
typedef struct graph_declaration {
    TSNode node;
    int parameter;
} graph_declaration;

typedef struct graph_import {
    char module[CBERG_GRAPH_NAME_MAX];
    char name[CBERG_GRAPH_NAME_MAX];
    int namespace;
} graph_import;

TSNode graph_field(TSNode node, const char *name);
int graph_is(TSNode node, const char *type);
int graph_text(const graph_syntax *syntax, TSNode node, char *out, size_t capacity);
int graph_name_is(const graph_syntax *syntax, TSNode node, const char *name);
int graph_scope_node(TSNode node);
int graph_find_import(const graph_syntax *syntax, const char *name, graph_import *out);
int graph_declaration_node(TSNode node);
/* Declarations `scope` owns directly, nearest-last-first. Returns 0 when the
 * cache is absent or out of memory; the caller then walks the scope itself. */
int graph_scope_declarations(cberg_graph_scope_cache *cache, TSNode scope, const graph_declaration **out, size_t *count);
int graph_import_node(TSNode node);
/* The root's import statements in source order. Returns 0 when the cache is
 * absent or out of memory; the caller then scans the root's children. */
int graph_root_imports(cberg_graph_scope_cache *cache, TSNode root, const TSNode **out, size_t *count);
int graph_find_value(const graph_syntax *syntax, TSNode reference, const char *name, TSNode *declaration, TSNode *type);
void graph_type_binding(const graph_syntax *syntax, TSNode type, cberg_graph_binding *out);
int32_t graph_definition_in_scope(const graph_syntax *syntax, TSNode scope, const char *name);
int32_t graph_visible_definition(const graph_syntax *syntax, TSNode reference, const char *name);

#endif
