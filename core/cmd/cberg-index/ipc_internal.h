#ifndef CBERG_IPC_INTERNAL_H
#define CBERG_IPC_INTERNAL_H

#include <stddef.h>

#include "indexer.h"

/* Socket transport (ipc.c). Returns 0 once every byte is sent. */
int cberg_ipc_write_all(int fd, const char *buf, size_t len);

/* Commands (ipc_commands.c). Each writes exactly one JSON reply line to fd.
 * `line` is one request without its newline; dispatch may modify it. */
void cberg_ipc_status(cberg_engine *eng, int fd);
void cberg_ipc_dispatch(cberg_engine *eng, int fd, char *line);

#endif
