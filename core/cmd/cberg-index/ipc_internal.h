#ifndef CBERG_IPC_INTERNAL_H
#define CBERG_IPC_INTERNAL_H

/*
 * Shared between the IPC translation units:
 *
 *   ipc.c                 socket ownership, accept loop, command dispatch
 *   ipc_wire.c            request fields and JSON response building
 *   ipc_chunk_commands.c  status, search, chunk, symbol, outline
 *   ipc_graph_commands.c  search_graph, trace_path, graph_stats/hubs/refs
 *
 * A request is one line: "<command>[\t<field>...]". A response is one line
 * of JSON. The protocol is documented in daemon/docs/ipc.md.
 */

#include "indexer.h"

/* ---------------------------------------------------------------- replies */

int ipc_write_all(int fd, const char *buf, size_t len);

/* Sends {"ok":false,"error":"<message>"}. The message must be JSON-safe. */
void ipc_send_error(int fd, const char *message);

/* Escapes `in` into out[cap], truncating on a whole escape when it fills. */
void ipc_json_escape(const char *in, char *out, size_t cap);

/* Appends formatted text at *off only when all of it fits before cap; on
 * overflow resp is left as it was and 0 is returned. */
int ipc_appendf(char *resp, size_t cap, size_t *off, const char *fmt, ...);

/* Bytes kept free at the end of every list response for its closing
 * `],"truncated":false}\n`, so the trailer always fits. */
#define IPC_TAIL_RESERVE 64

/* Where list items must stop in a response buffer of resp_size bytes. */
size_t ipc_list_cap(size_t resp_size);

/* Starts list item i and returns a mark; roll back to it when the item does
 * not fit, so a list ends on a whole item instead of a clipped one. */
size_t ipc_list_item_begin(char *resp, size_t cap, size_t *off, size_t i);
void ipc_list_item_rollback(char *resp, size_t *off, size_t mark);

size_t ipc_clamp_want(size_t limit, size_t cap);

/* True when the response cap may have clipped results the caller asked for. */
int ipc_cap_truncated(size_t found, size_t want, size_t limit, size_t cap);

/* --------------------------------------------------------- request fields */

/* Splits the next tab-separated field off *cursor in place; NULL at the end. */
char *ipc_next_field(char **cursor);

/* Empty fields become NULL so callers can pass them through unchanged. */
char *ipc_null_if_empty(char *field);

/* A count such as a limit or depth; `fallback` when missing, empty, or zero. */
size_t ipc_count_field(const char *field, size_t fallback);

/* --------------------------------------------------------------- commands */

/* Each handler parses `args` (the fields after the command name, modified in
 * place) and writes exactly one response to fd. */
typedef void ipc_handler(cberg_engine *eng, int fd, char *args);

void ipc_handle_status(cberg_engine *eng, int fd);

ipc_handler ipc_handle_search;
ipc_handler ipc_handle_chunk;
ipc_handler ipc_handle_symbol;
ipc_handler ipc_handle_outline;

ipc_handler ipc_handle_search_graph;
ipc_handler ipc_handle_trace_path;
ipc_handler ipc_handle_graph_stats;
ipc_handler ipc_handle_graph_hubs;
ipc_handler ipc_handle_graph_refs;

#endif
