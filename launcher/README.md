# codeberg launcher

One command to boot the whole code-search stack and drop you into the agent
chat — the way `claude` opens. It builds/downloads whatever is missing, starts
the daemon (which brings up the C indexer), waits for it to be healthy, and
hands the terminal to the agent TUI.

```sh
codeberg            # boot everything, open the chat TUI
```

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
  ├─ ensure built: make build-daemon (core+daemon), make build-agent (TUI)
  ├─ ensure model: scripts/fetch-model.sh   (vector mode only)
  ├─ start codeberg-d ──spawns──▶ cberg-index      (logs: ~/.codeberg/logs)
  ├─ poll GET /health until ready
  └─ exec  node agent/dist/tui.js   (your terminal)
        └─ on exit / SIGTERM ▶ stop daemon ▶ daemon stops the core
```

## Install (a `codeberg` command on PATH)

```sh
cd launcher
./install.sh            # builds and symlinks `codeberg` into a PATH dir
# or, manually:
go build -o "$(go env GOPATH)/bin/codeberg" ./cmd/codeberg
```

## First run

```sh
codeberg config init    # writes a starter ~/.codeberg/config
# edit it: set CODEBERG_ROOT (repo to index) + CODEBERG_MODEL (provider:model)
#          and the matching API key (ANTHROPIC_API_KEY / OPENAI_API_KEY / …)
codeberg                # builds anything missing, downloads the model, opens chat
```

On the very first `codeberg`, expect a one-time build of the components and a
~160 MB embedding-model download (skip the latter with `--no-vector` for
chunk-only mode). Both are cached afterwards — **the model is downloaded once**
into `~/.codeberg/models/` (not the repo), so it is reused across repo rebuilds,
re-clones, and multiple checkouts and is **never re-pulled** while it is present.

## Configuring

Config is resolved from four layers, **highest precedence first**:

1. CLI flags (`--root`, `--model`, `--port`, `--no-vector`, …)
2. process environment (`CODEBERG_ROOT`, `CODEBERG_MODEL`, `ANTHROPIC_API_KEY`, …)
3. `~/.codeberg/config` (KEY=VALUE; same names as the env vars)
4. built-in defaults

The launcher splits these back into the two scopes the components read —
**daemon scope** (`CODEBERG_ROOT`, `CBERG_MODEL` embedding model, `CBERG_INDEX_PATH`,
port, socket) and **agent scope** (`CODEBERG_MODEL` LLM, `CODEBERG_DAEMON_URL`,
`CODEBERG_REASONING`, API keys) — and injects each into the right child process.
The daemon never receives the LLM key.

Configuration is changeable any time after install — there's no need to
reinstall. Each run reads config fresh and the daemon restarts per session, so a
new root or model is picked up on the next `codeberg`.

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
| `codeberg build` | force (re)build/download of components and model |
| `codeberg doctor` | toolchain + artifact + config diagnostics |
| `codeberg config` | print resolved config |
| `codeberg config init` | write a starter `~/.codeberg/config` |
| `codeberg uninstall` | remove the command; ask before deleting model/data |
| `codeberg version` | print version |

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
  internal/config/           four-layer config resolution + template
  internal/bootstrap/        build/download components and model
  internal/run/              daemon start, /health wait, TUI, teardown
```
