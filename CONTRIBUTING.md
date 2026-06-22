# Contributing

Thanks for your interest in improving Codeberg! This guide covers how to set up,
test, and submit changes. Today the active codebase is the **C core** (`core/`);
`daemon/` and `agent/` are placeholders.

## Prerequisites

- **CMake 3.20+** and a C/C++ toolchain (clang or gcc). Ninja is used
  automatically if present.
- **Git** with submodule support — tree-sitter grammars are **not** pinned in git
  (they are gitignored and fetched locally). Run `make submodules` before the
  first build. Vendored **usearch** and **onnxruntime-extensions** are submodules
  tracked in the repository.
- **ONNX Runtime** (optional) — enables local embedding in `libcodeberg`. Install
  via your package manager (e.g. `brew install onnxruntime`) and set
  `ONNXRUNTIME_ROOT` if it is in a non-standard prefix. Without it the ONNX path
  is compiled out; vector search still builds via vendored usearch.

## Repository layout

```
codeberg/
├── VERSION              # single source of truth for release version
├── core/                # libcodeberg (CMake)
│   ├── include/codeberg/  public C ABI
│   ├── src/             common, chunk, watch, embed, search
│   ├── test/            ctest binaries
│   └── docs/            architecture, API, ADRs
├── daemon/              planned: scheduled git pull + HTTP API
├── agent/               planned: retrieval client
└── docs/                project-level documentation index
```

The public ABI lives in `core/include/codeberg/codeberg.h`. Internal helpers stay
in `core/src/` and are documented under `core/docs/modules/`.

## Common tasks

| Command | What it does |
| ------- | ------------ |
| `make submodules` | `git submodule update --init --recursive` |
| `make build` | Configure and compile `libcodeberg` |
| `make test` | Run all core tests (`ctest`) |
| `make test TEST=<name>` | Run one test binary (e.g. `test_chunker`) |
| `make check` | `build` + `test` (pre-PR gate; same as CI) |
| `make clean` | Remove `core/build` |
| `make set-version v=v0.2.0` | Bump `VERSION` (rebuild to propagate to the library) |

Optional embedding tests:

```sh
scripts/fetch-model.sh
export CBERG_TEST_MODEL=models/jina-embeddings-v2-base-code/model.onnx
make test TEST=test_embed
```

## Coding standards

- **Workflow is test-driven.** Write a failing test for the behavior, make it
  pass with minimal code, then refactor. Tests exercise the public C ABI and
  documented contracts, not private helpers, so they survive refactors.
- **C core:** keep `codeberg.h` small and stable. Every ABI function documents
  ownership of returned memory; opaque handles have matching `*_close` / `*_free`
  (all NULL-safe). Use exhaustive `switch` handling for discriminated unions and
  enums (`default:` with a `never` check).
- **Imports:** keep `#include` at the top of each translation unit.
- **Index root:** never hardcode a repository path. Use `CODEBERG_ROOT` /
  `cberg_config_*` or an explicit argument to `cberg_watcher_open`.
- **Secrets:** do not commit API keys, PATs, or model credentials.

## Tests

Unit tests live in `core/test/` and run via `ctest`. Tests that need the jina
ONNX model exit with code `77` (skipped) when `CBERG_TEST_MODEL` is unset.

## Submitting changes

1. Branch off `main`.
2. Run `make check` (and embedding tests if you touched `embed/`).
3. Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):
   e.g. `feat(watch): coalesce rename events`, `fix(chunk): stable ids on delete`.
   Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`. Mark
   breaking changes with `!` and note them in `CHANGELOG.md`.
4. Sign off every commit ([DCO](https://developercertificate.org/)): `git commit -s`.
5. Open a pull request describing the change and how you tested it. CI must be
   green before merge.

## Releases

See [docs/RELEASING.md](docs/RELEASING.md).

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
