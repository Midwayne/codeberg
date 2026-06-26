# Codeberg

Fast codebase indexing: parse source into semantic chunks, track changes incrementally,
embed into vectors, and search by meaning.

## Index root

The **index root** is the codebase tree Codeberg watches and indexes. It is not
hardcoded — configure it with the `CODEBERG_ROOT` environment variable:

```sh
export CODEBERG_ROOT=/path/to/your/repository
```

| Variable | Purpose |
|----------|---------|
| `CODEBERG_ROOT` | Absolute or relative path to the repository / workspace to index |

Library helpers (for daemons and future CLI tools):

- `cberg_config_index_root()` — read `CODEBERG_ROOT` from the environment
- `cberg_config_resolve_index_root(buf, cap)` — `realpath` into `buf` (validates the path exists)
- `cberg_watcher_open(root, …)` — pass the same path when opening the filesystem watcher

**Symlinks:** `CODEBERG_ROOT` may point at a symlink; the watcher resolves it at
open time and indexes the target tree. Symbolic links **inside** the tree are
followed — symlinked directories are walked and watched like normal directories.

## Layout

| Path | Role |
|------|------|
| `core/` | C library — chunking, change tracking, watching, ONNX embedding, usearch vector index ([docs](core/docs/)) |
| `daemon/` | Go `codeberg-d` — HTTP, tools, git pull; supervises C `cberg-index` |
| `agent/` | TypeScript ai-sdk agent (`codeberg-ask`) over the daemon API |
| `agent/` | Retrieval client — TBD |
| `docs/` | Project overview and links |

## Prerequisites

The build spans three toolchains plus a native library, so a fresh machine needs
all of the following before `make` or the launcher can succeed. Missing any of
them is the most common first-run failure — `make` fails deep in a configure step
without naming the package, so install these up front:

| Dependency | Why | macOS (Homebrew) | Debian/Ubuntu (apt) |
|------------|-----|------------------|---------------------|
| C toolchain + `make` | compile `libcodeberg` / `cberg-index` | `xcode-select --install` | `build-essential` |
| **CMake** | configure the C core | `brew install cmake` | `cmake` |
| **Go** ≥ 1.22 | build `codeberg-d` (daemon) | `brew install go` | `golang-go` |
| **Node** ≥ 22 + **npm** | build & run the TypeScript agent/TUI | `brew install node` | `nodejs npm` |
| `git` | fetch the tree-sitter submodules | `brew install git` | `git` |
| **ONNX Runtime** | vector embeddings (omit for chunk-only) | `brew install onnxruntime` | [release tarball](https://github.com/microsoft/onnxruntime/releases) or `ONNXRUNTIME_ROOT` |

The **ONNX Runtime** is a native library, not a CLI: CMake searches
`/opt/homebrew/opt/onnxruntime`, `/usr/local`, `/opt/homebrew`, and `/usr`, or
`ONNXRUNTIME_ROOT` if set. Without it the core still builds, but **chunk-only**
(no vector search) — pass `--no-vector` / set `CODEBERG_VECTOR=false`. It is not
packaged for apt, so on Linux install a release tarball and point
`ONNXRUNTIME_ROOT` at it.

> **The `codeberg` launcher installs these for you.** On first run it checks each
> dependency and auto-installs the missing ones via Homebrew (macOS) or apt
> (Linux) — see [`launcher/`](launcher/). Building by hand from this Makefile,
> you install them yourself. Run `codeberg doctor` to see what's present.

## Build

```sh
git submodule update --init --recursive
make build
make build-daemon   # codeberg-d (Go) + requires cberg-index from make build
```

Optional embedding tests:

```sh
scripts/fetch-model.sh
export CODEBERG_ROOT=/path/to/your/repository   # if your tooling reads it
export CBERG_TEST_MODEL=models/jina-embeddings-v2-base-code/model.onnx
make test TEST=test_embed
```

See [core/docs/CORE.md](core/docs/CORE.md) for architecture; [core/docs/API.md](core/docs/API.md) for the full API.

## Version

Release version is tracked in [`VERSION`](VERSION) and exposed at runtime via
`cberg_version()`. See [docs/RELEASING.md](docs/RELEASING.md) for the release
process.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The project is **test-driven** — write a
failing test for the behavior first. Run `make check` before opening a PR.

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE).
