# Codeberg documentation

Project-wide overview. **libcodeberg** details live under [core/docs](../core/docs/).

## Repository layout

| Path                  | Role                                                            |
| --------------------- | --------------------------------------------------------------- |
| [core/](../core/)     | C library — chunking, change tracking, embedding, vector search |
| [daemon/](../daemon/) | Go daemons — `cberg-index`, `codeberg-d` ([daemon/README.md](../daemon/README.md)) |
| [agent/](../agent/)   | Retrieval client (planned)                                      |

## Core library

| Document | Description |
|----------|-------------|
| [core/docs/README.md](../core/docs/README.md) | Documentation index |
| [core/docs/CORE.md](../core/docs/CORE.md) | Architecture and design |
| [core/docs/API.md](../core/docs/API.md) | Complete public API (every `codeberg.h` function) |
| [core/docs/modules/](../core/docs/modules/) | Implementation reference (every source function) |
| [core/docs/adr/](../core/docs/adr/) | Architecture decision records |

## Build

```sh
git submodule update --init --recursive
make build-core
make build-daemon
make test
```

Set **`CODEBERG_ROOT`** to the codebase tree you index (see [../README.md](../README.md)).

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
