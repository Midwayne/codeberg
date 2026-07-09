# Codeberg documentation

Project-wide overview. **libcodeberg** details live under [core/docs](../core/docs/).

## Repository layout

| Path                  | Role                                                            |
| --------------------- | --------------------------------------------------------------- |
| [core/](../core/)     | C library — chunking, change tracking, embedding, vector search |
| [daemon/](../daemon/) | Go daemons — `cberg-index`, `codeberg-d` ([daemon/README.md](../daemon/README.md)) |
| [agent/](../agent/)   | TypeScript ai-sdk agent (chat TUI + browser UI) over the daemon API |
| [launcher/](../launcher/) | Standalone `codeberg` CLI — boots the stack, resolves config, manages the repo registry ([launcher/README.md](../launcher/README.md)) |

## Multi-repo search

| Document | Description |
|----------|-------------|
| [multi-repo.md](multi-repo.md) | Indexing/searching multiple repos — `--all`, `--repos`, `--no-index`, the repo registry, and the underlying architecture |
| [core/docs/adr/0004-multi-root-engine.md](../core/docs/adr/0004-multi-root-engine.md) | ADR: one process, one shared embedder, per-root state |
| [daemon/docs/ipc.md](../daemon/docs/ipc.md) | `cberg-index` ↔ `codeberg-d` wire protocol (repo-scoped search, per-repo status) |
| [daemon/docs/http.md](../daemon/docs/http.md) | Daemon HTTP API and agent tools, including `repos` and the `repo` argument |

## Daemon

| Document | Description |
|----------|-------------|
| [daemon/README.md](../daemon/README.md) | Build, config, tools overview |
| [daemon/docs/architecture.md](../daemon/docs/architecture.md) | Startup flow, package graph, security |
| [daemon/docs/http.md](../daemon/docs/http.md) | HTTP API and agent tools |
| [daemon/docs/ipc.md](../daemon/docs/ipc.md) | Unix socket protocol to `cberg-index` |

## Agent

| Document | Description |
|----------|-------------|
| [agent/README.md](../agent/README.md) | CLI, TUI, web UI, providers, daemon client |
| [agent/web-ui/README.md](../agent/web-ui/README.md) | React chat SPA development |
| [agent-accuracy.md](agent-accuracy.md) | Retrieval quality & eval roadmap |

## Knowledge graph (dual index)

| Document | Description |
|----------|-------------|
| [core/docs/adr/0005-dual-index-graph.md](../core/docs/adr/0005-dual-index-graph.md) | ADR: chunks/vectors + knowledge graph sidecar |
| [core/docs/modules/graph.md](../core/docs/modules/graph.md) | Implementation: schema, extract, resolve, IPC, tools, tests |
| [core/docs/CBERG_INDEX.md](../core/docs/CBERG_INDEX.md) | Indexer env (`CBERG_GRAPH`), on-disk `.graph` layout |
| [daemon/docs/ipc.md](../daemon/docs/ipc.md) | `search_graph`, `trace_path`, `graph_stats`, `graph_hubs`, `graph_refs` |
| [daemon/docs/http.md](../daemon/docs/http.md) | Agent tools: `detect_changes`, `get_architecture`, `find_references` |
| [agent-accuracy.md](agent-accuracy.md) | Agent answer quality (eval, hybrid retrieval, citations) |

## Architecture decisions

| Document | Description |
|----------|-------------|
| [core/docs/adr/](../core/docs/adr/) | All ADRs (0001–0005), including dual-index graph |
| [agent-accuracy.md](agent-accuracy.md) | Agent answer quality (eval, hybrid retrieval, citations) |

## Core library

| Document | Description |
|----------|-------------|
| [core/docs/README.md](../core/docs/README.md) | Documentation index |
| [core/docs/CORE.md](../core/docs/CORE.md) | Architecture and design |
| [core/docs/API.md](../core/docs/API.md) | Complete public API (every `codeberg.h` function) |
| [core/docs/CBERG_INDEX.md](../core/docs/CBERG_INDEX.md) | `cberg-index` binary — env, lifecycle, on-disk layout |
| [core/docs/VECTOR_INDEX_PROVIDERS.md](../core/docs/VECTOR_INDEX_PROVIDERS.md) | Vector backends — usearch, Qdrant, pgvector setup and schemas |
| [core/docs/TESTING.md](../core/docs/TESTING.md) | CTest binaries and ONNX test setup |
| [core/docs/modules/](../core/docs/modules/) | Implementation reference (every source function) |
| [core/docs/adr/](../core/docs/adr/) | Architecture decision records |

## Build

```sh
git submodule update --init --recursive
make build-core
make build-daemon
make test
```

Set **`CODEBERG_ROOT`** to the codebase tree you index, or **`CODEBERG_ROOTS`**
to serve several at once (see [../README.md](../README.md) and
[multi-repo.md](multi-repo.md)).

## Project governance

| Document | Description |
|----------|-------------|
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | How to build, test, and submit changes |
| [../CHANGELOG.md](../CHANGELOG.md) | Notable changes by version |
| [../SECURITY.md](../SECURITY.md) | Vulnerability reporting |
| [../CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Community standards |
| [RELEASING.md](RELEASING.md) | Version bumps and tags |
| [../VERSION](../VERSION) | Current release version |

See [core/README.md](../core/README.md) for module overview and optional ONNX model setup.
