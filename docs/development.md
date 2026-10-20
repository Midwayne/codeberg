# Developer setup

This guide covers building and running Codeberg from source. For the prebuilt
installer, see the [README](../README.md#install).

## Prerequisites

The source build uses C/C++, Go, and Node. Install the build tools below before
running `make`; embedding runtimes and Python depend on the features you enable.

| Dependency | Why | macOS (Homebrew) | Debian/Ubuntu (apt) |
|------------|-----|------------------|---------------------|
| C toolchain + `make` | compile `libcodeberg` / `cberg-index` | `xcode-select --install` | `build-essential` |
| **CMake** ≥ 3.20 | configure the C core | `brew install cmake` | `cmake` |
| **Go** ≥ 1.22 | build the launcher and `codeberg-d` | `brew install go` | `golang-go` |
| **Node** 22.13+ (22.x) or ≥ 24 + **npm** | build and run the TypeScript agent | `brew install node` | Install a supported Node version (distribution `nodejs` packages may be older) |
| `git` | fetch the tree-sitter submodules | `brew install git` | `git` |
| **ONNX Runtime** | Jina ONNX embeddings (optional) | `brew install onnxruntime` | [release tarball](https://github.com/microsoft/onnxruntime/releases) or `ONNXRUNTIME_ROOT` |
| **Python 3** ≥ 3.10 | Default EmbeddingGemma setup and optional SearXNG web search | `brew install python` | `python3-venv python3-pip` |

Check `node --version` in the shell that launches Codeberg. An older Node can
start the web UI but fail on the first message because the AI SDK needs
`AbortSignal.any`. Codeberg now checks the actual Node binary before starting
the agent and points to the required upgrade instead of surfacing a chat error.

The **ONNX Runtime** is a native library, not a CLI: CMake searches
`/opt/homebrew/opt/onnxruntime`, `/usr/local`, `/opt/homebrew`, and `/usr`, or
the `ONNXRUNTIME_ROOT` CMake variable when supplied. Without it the core still
builds, but Jina ONNX embedding is unavailable.
Other embedding adapters have their own runtimes; use `--no-vector` /
`CODEBERG_VECTOR=false` to skip all embedding setup. It is not
packaged for apt, so on Linux install a release tarball and point
`ONNXRUNTIME_ROOT` at it.

**Python embedding models need Python 3.10+ with venv and pip.** The default
EmbeddingGemma model downloads its managed runtime and weights on first use.
See [Indexing and search](../agent/web-ui/src/docs/content/indexing.md) for
other adapters.

**Python needs both packages on Debian/Ubuntu.** `python3-venv` alone is not
enough: Debian strips `ensurepip`'s bundled wheels from the base `python3`
package, so a venv created from it has **no pip** until `python3-pip` is also
installed system-wide (it supplies the wheels `ensurepip` bootstraps from).
Missing this shows up as `pip install SearXNG requirements` failing during
`codeberg build`/first run. The launcher's dependency preflight
(`deps.EnsurePython`) checks for a *working* pip, not just the `python3`
binary, and installs `python3-pip` automatically on apt hosts.

> **The source launcher checks build dependencies for you.** After you install
> Git and Go and build the launcher, it can install missing build packages via
> Homebrew (macOS) or apt (Linux) — see [`launcher/`](../launcher/). Building
> directly from the repository Makefile,
> you install them yourself. Run `codeberg doctor` to see what's present.

> **Web search** is optional and off by default. Enable it in **Settings → Tools**.
> Once enabled, the launcher
> installs a local [SearXNG](https://github.com/searxng/searxng) (open-source, no
> API key) into a managed Python venv under `~/.codeberg/searxng` and runs it
> only while codeberg is running — it is stopped on exit, never left in the
> background. Turning the switch off cancels setup and stops the local service.
> Point at your own instance with `CODEBERG_SEARXNG_URL` and enable search.
> `CODEBERG_WEB_USE=false` disables all web access. Without Python, `web_search` is skipped and the
> agent's `fetch_url` still works.

## Clone and run

Install Git and Go 1.22+ first so you can clone the repository and build the
launcher:

```sh
git clone --recurse-submodules https://github.com/Midwayne/codeberg.git
cd codeberg
./launcher/install.sh
codeberg
```

The launcher builds missing components, opens the browser UI, and manages its
local processes. Its source dependency check can install missing packages using
Homebrew or apt. Building directly with `make` requires installing prerequisites
yourself. Set `CODEBERG_SKIP_DEP_INSTALL=1` to check dependencies without installing
them. `codeberg doctor` reports the detected setup.

If the install script cannot find a writable directory on PATH, it prints the
launcher location and symlink instructions. You can also run it directly from
the checkout:

```sh
./launcher/bin/codeberg
```

In the browser, add a project and configure a chat model and its provider
credentials. For a first run without embedding downloads, use
`codeberg --no-vector`.

## Build components manually

Run these commands from the repository root after installing the prerequisites:

```sh
git submodule update --init --recursive
make build-core
make build-daemon
make build-agent
make build-web-ui
./launcher/install.sh
codeberg
```

`make build-daemon` also builds the C core. `make build-agent` builds the agent;
`make build-web-ui` builds the browser SPA separately. After editing source,
re-run the relevant build target or use `codeberg build` to force a rebuild.
Normal launcher startup builds missing artifacts rather than detecting all
source edits.

To use Jina ONNX with a runtime installed outside the standard prefixes, pass
the prefix to CMake explicitly before building the daemon:

```sh
cmake -S core -B core/build -DCMAKE_BUILD_TYPE=Release \
  -DONNXRUNTIME_ROOT=/path/to/onnxruntime
cmake --build core/build --parallel
make build-daemon
```

The CMake variable selects the headers and libraries at build time. A shell
`ONNXRUNTIME_ROOT` value alone does not configure CMake. On Linux, ensure the
shared library can also be loaded at runtime; set `LD_LIBRARY_PATH` to its `lib`
directory if needed.

## Configuration and direct component runs

`codeberg config init` writes a minimal starter `~/.codeberg/config`.
The [full configuration example](../launcher/internal/config/config.example)
lists launcher, daemon, and agent settings and their precedence.

For development without the launcher, `make run-daemon` loads `daemon/.env` and
`make run-agent` / `make run-agent-web` load `agent/.env`. Start from
[daemon/.env.example](../daemon/.env.example) and
[agent/.env.example](../agent/.env.example). Keep provider credentials in the
agent configuration; the daemon does not need them. Do not commit secrets.

For a chunk-only daemon, leave `CBERG_MODEL` and `CBERG_INDEX_PATH` unset in
`daemon/.env`. Supply a keyed repository root in the shell:

```sh
# Terminal 1, from the repository root
export CODEBERG_ROOTS="$(printf 'repo\t%s' "$(git rev-parse --show-toplevel)")"
make run-daemon
```

Set `CODEBERG_MODEL=provider:model` and the matching credentials in `agent/.env`.
The standalone daemon defaults to port 8080, so set
`CODEBERG_DAEMON_URL=http://127.0.0.1:8080` in `agent/.env`, then run:

```sh
# Terminal 2, from the repository root
make run-agent q="where is chunking implemented?"
# Or start the browser app:
make run-agent-web
```

For browser hot reload, keep the daemon and agent web server running, then run
`npm run dev --prefix agent/web-ui` in another terminal. Vite proxies API requests
to `http://127.0.0.1:48088`. See the [web UI guide](../agent/web-ui/README.md)
and [UI demo](../agent/web-ui/demo/README.md) for more development options.

## Verification

Run the checks for the layer you changed:

```sh
make check                     # C core: build and tests
make daemon-check              # Go daemon: lint, vet, tests, build
npm ci --prefix agent
npm ci --prefix agent/web-ui
make agent-check               # Agent and UI: lint, types, tests, builds
```

For launcher changes, run `go test ./...` from `launcher/`.
To run a single core test after building:

```sh
ctest --test-dir core/build --output-on-failure -R '^test_chunker$'
```

Optional Jina embedding tests require an ONNX-enabled build and model download:

```sh
scripts/fetch-model.sh
export CBERG_TEST_MODEL=models/jina-embeddings-v2-base-code/model.onnx
ctest --test-dir core/build --output-on-failure -R '^(test_embed|test_search)$'
```

Without the model, these optional tests are skipped. See
[core testing](../core/docs/TESTING.md) for the full test reference.

## Index roots

The **index root** is the codebase tree Codeberg watches and indexes. At the
library/daemon level it's not hardcoded. Start `codeberg` and choose **Add
project** in the browser; saved projects are restored on later launches.
For an explicit terminal startup project, use `codeberg /path/to/repository` or
`codeberg --root /path/to/api,/path/to/frontend`. With no saved projects, the UI
shows **Add a project to get started**, and the daemon remains idle. Deleting
all projects returns to that state, including after a restart.

`CODEBERG_ROOTS` is the internal newline-separated `key<TAB>path` transport
from the project catalog or launcher to the daemon and indexer. Normal users
manage repository paths through the UI.

Library helpers (for daemons and CLI tools):

- `cberg_config_index_root()` — read a single keyed repository path from the internal roots transport; returns NULL for multiple repositories
- `cberg_config_resolve_index_root(buf, cap)` — `realpath` into `buf` (validates the path exists)
- `cberg_watcher_open(root, …)` — pass the same path when opening the filesystem watcher

**Symlinks:** a root may point at a symlink; the watcher resolves it at open
time and indexes the target tree. Symbolic links **inside** the tree are
followed — symlinked directories are walked and watched like normal directories.

**Multiple repos:** the launcher remembers every root you index and can search
across all (or a chosen subset) of them combined —
`codeberg <dir>` to index one, then `codeberg --all` or
`codeberg --repos a,b`. See [docs/multi-repo.md](../docs/multi-repo.md) for the
full picture and [launcher/README.md](../launcher/README.md#multi-repo-search)
for the CLI-level walkthrough.

## Repository layout

| Path | Role |
|------|------|
| `core/` | C library — chunking, change tracking, watching, knowledge graph, ONNX embedding, usearch vector index ([docs](../core/docs/)) |
| `daemon/` | Go `codeberg-d` — HTTP, tools, git pull; supervises C `cberg-index` ([docs](../daemon/README.md)) |
| `agent/` | TypeScript ai-sdk agent — browser UI + one-shot CLI — over the daemon API ([docs](../agent/README.md)) |
| `launcher/` | Standalone `codeberg` CLI — boots the stack, resolves config, manages the repo registry ([docs](../launcher/README.md)) |
| `docs/` | Project overview, multi-repo guide, and links |

## More references

- [Core architecture](../core/docs/CORE.md) and [C API](../core/docs/API.md)
- [Daemon HTTP API and tools](../daemon/docs/http.md)
- [Launcher](../launcher/README.md) and [agent](../agent/README.md)
- [Contributing](../CONTRIBUTING.md), including coding standards and PR requirements
- [Release packaging](releases.md) and [versioning](RELEASING.md)

The release version is tracked in [VERSION](../VERSION) and exposed through
`cberg_version()`.
