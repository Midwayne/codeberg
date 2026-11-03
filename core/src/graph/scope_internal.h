#ifndef CBERG_GRAPH_SCOPE_INTERNAL_H
#define CBERG_GRAPH_SCOPE_INTERNAL_H

#include "graph_internal.h"

typedef struct graph_syntax {
    const cberg_graph_fragment *fragment;
    TSNode root;
    const char *source;
    size_t length;
} graph_syntax;

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
int graph_find_value(const graph_syntax *syntax, TSNode reference, const char *name, TSNode *declaration, TSNode *type);
void graph_type_binding(const graph_syntax *syntax, TSNode type, cberg_graph_binding *out);
int32_t graph_definition_in_scope(const graph_syntax *syntax, TSNode scope, const char *name);
int32_t graph_visible_definition(const graph_syntax *syntax, TSNode reference, const char *name);

#endif
