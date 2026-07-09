# Codeberg

Fast codebase indexing: parse source into semantic chunks, track changes incrementally,
embed into vectors, search by meaning, and query a structural knowledge graph
(callers, imports, blast radius) beside the chunk/vector index.

## Install

See [Prerequisites](#prerequisites) and [Build](#build), then run via the
[`launcher/`](launcher/) — one `codeberg` command boots the daemon, indexer, and
chat TUI, and auto-installs missing toolchains. `make dist` assembles a portable,
prebuilt tree the launcher can run from anywhere (`codeberg --dist DIR`); packaged
installers (a Homebrew tap) will build on that for a later release.
[`launcher/internal/config/config.example`](launcher/internal/config/config.example) lists every launcher, daemon, and agent setting
(`codeberg config init` writes a minimal starter `~/.codeberg/config`; see that file for the full reference).

## Index root(s)

The **index root** is the codebase tree Codeberg watches and indexes. At the
library/daemon level it's not hardcoded — configure one with the
`CODEBERG_ROOT` environment variable:

```sh
export CODEBERG_ROOT=/path/to/your/repository
```

| Variable | Purpose |
|----------|---------|
| `CODEBERG_ROOT` | Path(s) to index when pinned: one directory, or comma-separated list. When set, only these trees are indexed; `--all` / `--repos` are not allowed. Unset to search the registry instead. |
| `CODEBERG_ROOTS` | `key\tpath` records, newline-separated — every repo the daemon serves (built by the launcher from `CODEBERG_ROOT` or the registry; supersedes `CODEBERG_ROOT` when set directly) |

Library helpers (for daemons and CLI tools):

- `cberg_config_index_root()` — read `CODEBERG_ROOT` from the environment
- `cberg_config_resolve_index_root(buf, cap)` — `realpath` into `buf` (validates the path exists)
- `cberg_watcher_open(root, …)` — pass the same path when opening the filesystem watcher

**Symlinks:** a root may point at a symlink; the watcher resolves it at open
time and indexes the target tree. Symbolic links **inside** the tree are
followed — symlinked directories are walked and watched like normal directories.

**Multiple repos:** the launcher remembers every root you index and can search
across all (or a chosen subset) of them combined —
`codeberg <dir>` to index one, then `codeberg --all` or
`codeberg --repos a,b`. See [docs/multi-repo.md](docs/multi-repo.md) for the
full picture and [launcher/README.md](launcher/README.md#multi-repo-search)
for the CLI-level walkthrough.

## Layout

| Path | Role |
|------|------|
| `core/` | C library — chunking, change tracking, watching, knowledge graph, ONNX embedding, usearch vector index ([docs](core/docs/)) |
| `daemon/` | Go `codeberg-d` — HTTP, tools, git pull; supervises C `cberg-index` ([docs](daemon/README.md)) |
| `agent/` | TypeScript ai-sdk agent — chat TUI + browser UI — over the daemon API ([docs](agent/README.md)) |
| `launcher/` | Standalone `codeberg` CLI — boots the stack, resolves config, manages the repo registry ([docs](launcher/README.md)) |
| `docs/` | Project overview, multi-repo guide, and links |

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
| **Python 3** ≥ 3.10 _(optional)_ | web search (`web_search` via SearXNG) | `brew install python` | `python3-venv python3-pip` |

The **ONNX Runtime** is a native library, not a CLI: CMake searches
`/opt/homebrew/opt/onnxruntime`, `/usr/local`, `/opt/homebrew`, and `/usr`, or
`ONNXRUNTIME_ROOT` if set. Without it the core still builds, but **chunk-only**
(no vector search) — pass `--no-vector` / set `CODEBERG_VECTOR=false`. It is not
packaged for apt, so on Linux install a release tarball and point
`ONNXRUNTIME_ROOT` at it.

**Python needs both packages on Debian/Ubuntu.** `python3-venv` alone is not
enough: Debian strips `ensurepip`'s bundled wheels from the base `python3`
package, so a venv created from it has **no pip** until `python3-pip` is also
installed system-wide (it supplies the wheels `ensurepip` bootstraps from).
Missing this shows up as `pip install SearXNG requirements` failing during
`codeberg build`/first run. The launcher's dependency preflight
(`deps.EnsurePython`) checks for a *working* pip, not just the `python3`
binary, and installs `python3-pip` automatically on apt hosts.

> **The `codeberg` launcher installs these for you.** On first run it checks each
> dependency and auto-installs the missing ones via Homebrew (macOS) or apt
> (Linux) — see [`launcher/`](launcher/). Building by hand from this Makefile,
> you install them yourself. Run `codeberg doctor` to see what's present.

> **Web search** is optional and on by default. On first run the launcher
> installs a local [SearXNG](https://github.com/searxng/searxng) (open-source, no
> API key) into a managed Python venv under `~/.codeberg/searxng` and runs it
> only while codeberg is running — it is stopped on exit, never left in the
> background. Disable with `CODEBERG_WEB_USE=false`, or point at your own instance
> with `CODEBERG_SEARXNG_URL`. Without Python, `web_search` is skipped and the
> agent's `fetch_url` still works.

## Build

```sh
git submodule update --init --recursive
make build-core
make build-daemon   # codeberg-d (Go) + requires cberg-index from make build-core
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
