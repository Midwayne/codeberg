# codeberg launcher

One command to boot the whole code-search stack and drop you into the agent
chat — the way `claude` opens. It builds/downloads whatever is missing, starts
the daemon (which brings up the C indexer), waits for it to be healthy, and
hands the terminal to the agent TUI.

```sh
codeberg            # boot everything, open the chat TUI
codeberg --web      # …or open the chat in your browser instead
```

`--web` runs the same agent behind a local HTTP server (`codeberg-web`) and opens
the browser chat at `http://127.0.0.1:48088` — an uncommon high port (not the
much-contended 3000), grouped just past the daemon's 48080. Override it with
`--web-port` / `CODEBERG_WEB_PORT`, or make web the default with
`CODEBERG_WEB=true`.

## Why it's a separate component

This `launcher/` is a **standalone Go module**. It does not import any code from
`core/`, `daemon/`, or `agent/` — it only finds their files on disk and runs
them as subprocesses / talks to the daemon over HTTP. That keeps the three
components individually buildable and lets the launcher itself grow into
something deployable on its own (e.g. a cloud entrypoint) later.

## What "start core, then daemon, then TUI" really is

The daemon already **supervises the core**: `codeberg-d` spawns `cberg-index`,
restarts it on crash, and kills it on shutdown. So there are only two processes
to launch — the daemon and the TUI — and the launcher manages both:

```
codeberg
  ├─ ensure deps:  cmake, go, node/npm, git, onnxruntime  (auto-install: brew/apt)
  ├─ ensure built: make build-daemon (core+daemon), make build-agent (TUI)
  ├─ ensure model: scripts/fetch-model.sh   (vector mode only)
  ├─ start codeberg-d ──spawns──▶ cberg-index      (logs: ~/.codeberg/logs)
  ├─ poll GET /health until ready  (first cold index is slow — up to 15m)
  └─ exec  node agent/dist/tui.js   (your terminal)
        │     …or with --web: node agent/dist/web.js, then open the browser
        └─ on exit / SIGTERM ▶ stop daemon ▶ daemon stops the core
```

## Install (a `codeberg` command on PATH)

```sh
cd launcher
./install.sh            # builds and symlinks `codeberg` into a PATH dir
# or, manually:
go build -o "$(go env GOPATH)/bin/codeberg" ./cmd/codeberg
```

### Source checkout vs. prebuilt install

The launcher runs the same two ways:

- **From a source checkout** (developer flow): it finds the tree with `core/`,
  `daemon/`, `agent/`, builds anything missing, and runs from `core/build/bin` +
  `agent/dist`.
- **From a prebuilt dist**: a packaged directory (`bin/codeberg` next to
  `libexec/` holding the binaries, agent bundle + `node_modules`, and `scripts/`)
  that `make dist` assembles. Nothing is built — it just runs. The launcher finds
  the payload at `../libexec` relative to its own binary, so the tree works
  wherever it's extracted; a populated dist is preferred over a checkout, and you
  can also point at one with `--dist DIR` / `CODEBERG_DIST`. `codeberg doctor`
  shows which it resolved. (Packaged installers will build on this later.)

## First run

```sh
codeberg config init    # writes a starter ~/.codeberg/config (from config.example)
# edit it: set CODEBERG_ROOT (repo to index) + CODEBERG_MODEL (provider:model)
#          and the matching API key (ANTHROPIC_API_KEY / OPENAI_API_KEY / …)
codeberg                # builds anything missing, downloads the model, opens chat
```

On the very first `codeberg`, expect a one-time build of the components and a
~160 MB embedding-model download (skip the latter with `--no-vector` for
chunk-only mode). Both are cached afterwards — **the model is downloaded once**
into `~/.codeberg/models/` (not the repo), so it is reused across repo rebuilds,
re-clones, and multiple checkouts and is **never re-pulled** while it is present.

### Dependencies (auto-installed)

The build needs a C toolchain + `make`, **CMake**, **Go** ≥ 1.22, **Node** ≥ 22
+ npm, `git`, and the **ONNX Runtime** library (for vector embeddings). Before
building, the launcher checks each and installs the missing ones through the host
package manager — **Homebrew** on macOS, **apt** on Linux (`onnxruntime` is not in
apt; install a [release](https://github.com/microsoft/onnxruntime/releases) and
set `ONNXRUNTIME_ROOT`). Without ONNX the core still builds chunk-only, so the
runtime only warns; the rest are required. `codeberg doctor` lists what's present.

Set `CODEBERG_SKIP_DEP_INSTALL=1` to check-and-report without installing (e.g. on
a locked-down host where you manage packages yourself).

`web_search` needs a separate, optional Python 3 preflight (`deps.EnsurePython`,
only run when web tools are enabled): it checks for a *working pip*, not just a
`python3` binary — on Debian/Ubuntu, `python3-venv` alone leaves `ensurepip`
without its bundled wheels, so a venv built from the bare system python3 has no
pip until `python3-pip` is installed too. The launcher installs both on apt
hosts automatically; Homebrew's `python` formula bundles pip already. See the
[repo README's prerequisites table](../README.md#prerequisites) for the full
dependency list.

### First index can be slow

The daemon only serves `/health` after the indexer has chunked and **embedded**
the whole tree, and a *cold* first index of a large repo can run several minutes.
The launcher waits up to **15 minutes** (it used to be 6, which a big repo would
blow past, forcing a second run). For an exceptionally large tree, raise it:

```sh
CODEBERG_HEALTH_TIMEOUT=30m codeberg     # any Go duration, e.g. 45m
```

Live indexing progress streams to the terminal during the wait; the full log is
at `~/.codeberg/logs/daemon.log`. Subsequent runs warm-start from the persisted
index and come up in seconds.

## Configuring

Config is resolved from four layers, **highest precedence first**:

1. CLI flags (`--root`, `--all`, `--repos`, `--no-index`, `--model`, `--port`, `--no-vector`, …)
2. process environment (`CODEBERG_ROOT`, `CODEBERG_ALL`, `CODEBERG_REPOS`, `CODEBERG_NO_INDEX`, `CODEBERG_MODEL`, `ANTHROPIC_API_KEY`, …)
3. `~/.codeberg/config` (KEY=VALUE; same names as the env vars). See
   [`launcher/internal/config/config.example`](internal/config/config.example) for every supported key.
4. built-in defaults

The launcher splits these back into the two scopes the components read —
**daemon scope** (`CODEBERG_ROOT`, `CBERG_MODEL` embedding model, `CBERG_INDEX_PATH`,
port, socket) and **agent scope** (`CODEBERG_MODEL` LLM, `CODEBERG_DAEMON_URL`,
`CODEBERG_REASONING`, API keys) — and injects each into the right child process.
The daemon never receives the LLM key.

Configuration is changeable any time after install — there's no need to
reinstall. Each run reads config fresh and the daemon restarts per session, so a
new root or model is picked up on the next `codeberg`.

When `CODEBERG_ROOT` is set (in config or via `--root`), **only** those
directories are indexed — comma-separate several paths to index a fixed set.
Unset `CODEBERG_ROOT` to search across the repo registry with `--all` or
`--repos` instead; the two modes do not combine.

```sh
codeberg config                       # print the resolved config (secrets masked)
codeberg config path                  # where the config file lives
codeberg config get CODEBERG_MODEL    # print one resolved value
codeberg config set CODEBERG_ROOT=~/proj CODEBERG_MODEL=openai:gpt-4o   # set keys
codeberg config unset CODEBERG_REASONING   # remove a key
codeberg config edit                  # open the config file in $EDITOR
codeberg doctor                       # toolchains, binaries, model, and config
codeberg --root ~/proj --model anthropic:claude-haiku-4-5   # one-off overrides
```

`config set` upserts in place (uncommenting a template line if present) and
preserves your comments; `config get` prints the fully-resolved value across all
layers. See `codeberg help` for common workflows.

> **Note on editing config inside the chat.** The agent's chat UI is
> `@ai-sdk/tui`'s `runAgentTUI`, which exposes no slash commands or settings
> hooks — so there is no mid-chat `/config` yet. For now config lives in the
> file + flags above. (Changing `CODEBERG_ROOT` or the embedding model requires
> a daemon restart regardless, since the core reads them at startup.) A richer
> in-app settings experience would mean replacing that TUI; it's intentionally
> left as a later step.

## Commands

| Command | Does |
|---|---|
| `codeberg` / `codeberg run` | bootstrap if needed, then boot daemon + TUI |
| `codeberg <dir>` | shorthand for `--root <dir>`; also registers the repo |
| `codeberg --all` | search every registered repo, combined |
| `codeberg --repos a,b` | search a chosen subset of dirs/keys, combined |
| `codeberg --no-index` | one-off run: register nothing, build no vector index |
| `codeberg --web` | same, but serve the browser chat UI instead of the TUI |
| `codeberg repos` | list registered repos (what `--all` searches) |
| `codeberg build` | force (re)build/download of components and model |
| `codeberg doctor` | toolchain + artifact + config diagnostics |
| `codeberg config` | print resolved config |
| `codeberg config init` | write a starter `~/.codeberg/config` |
| `codeberg clean-index` | prune cached per-directory vector indexes |
| `codeberg uninstall` | remove the command; ask before deleting model/data |
| `codeberg version` | print version |

## Multi-repo search

Every directory you index (without `--no-index`) is remembered in
`~/.codeberg/repos`, so a later `codeberg --all` can search all of them
combined — or `codeberg --repos a,b` a chosen subset by directory path or repo
key. `--no-index` runs a directory as a one-off: nothing is registered and no
vector index is built (file tools and chat still work; semantic search does
not). See [docs/multi-repo.md](../docs/multi-repo.md) for the full picture —
registry format, repo keys, how cross-repo search ranking and startup timing
work, and the underlying architecture.

```sh
codeberg ~/proj-a               # index + register
codeberg ~/proj-b               # index + register another
codeberg --all                  # search both combined
codeberg --repos proj-a,proj-b  # same two, named explicitly
codeberg ~/scratch --no-index   # try a directory without registering it
codeberg repos                  # see what's registered
```

## Index storage

Each indexed directory gets its **own** vector index, keyed by a hash of the
resolved root path: the core writes `<CBERG_INDEX_PATH>.<roothash>` plus
`.chunks`/`.manifest` sidecars under `~/.codeberg/index/`. So switching
`--root`/`CODEBERG_ROOT` never mixes chunks between repos. In `--all`/`--repos`
mode, one `cberg-index` process opens **one index per served repo** (sharing a
single embedding model) rather than the one this section originally described
for single-root mode — see [docs/multi-repo.md](../docs/multi-repo.md#architecture-implementation-notes).
Reverting to a previous root reuses its cached embeddings.

Because each root keeps its files indefinitely, browsing many repos accumulates
them. Reclaim the space any time:

```sh
codeberg clean-index --dry-run   # list cached index sets + sizes
codeberg clean-index             # prune them (active repo re-embeds next run)
```

It prunes *all* sets (it can't single out the active one without re-deriving the
core's XXH3 hash); the repo you next open simply rebuilds its index.

## Uninstall

```sh
codeberg uninstall
```

Removes the `codeberg` command from PATH, then **asks separately** before
deleting anything destructive (each prompt defaults to **No**):

- the embedding model + ONNX weights at `~/.codeberg/models` (~160 MB);
- the rest of the launcher data (config, index, logs) under `~/.codeberg`;
- the **system** ONNX runtime — this is a shared Homebrew package the launcher
  did not install, so it is only removed on an interactive yes or with
  `--remove-system-onnx` (and **`--yes` never removes it**).

The source checkout and its build artifacts (`core/build`, `agent/dist`) are
left intact — run `make clean` to remove those. Flags: `--yes` (assume yes for
the launcher's own assets, for scripts), `--home DIR`, `--remove-system-onnx`.

## Layout

```
launcher/
  cmd/codeberg/main.go       CLI dispatch + flags
  internal/paths/            repo + home directory discovery
  internal/registry/         ~/.codeberg/repos — remembers every indexed repo
  internal/config/           four-layer config resolution + template
  internal/deps/             toolchain/library preflight + auto-install (brew/apt)
  internal/bootstrap/        build/download components and model
  internal/run/              daemon start, /health wait, TUI, teardown
```
