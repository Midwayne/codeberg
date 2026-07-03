#ifndef CBERG_IPC_H
#define CBERG_IPC_H

#include "indexer.h"

typedef struct cberg_ipc_server cberg_ipc_server;

int cberg_ipc_start(cberg_engine *eng, cberg_ipc_server **out);
void cberg_ipc_stop(cberg_ipc_server *srv);

#endif
