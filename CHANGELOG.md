# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-v1, breaking
changes may occur in minor releases and are called out explicitly.

## [Unreleased]

### Added

- **Markdown indexing** — `.md`/`.markdown` files are now chunked and indexed
  (previously skipped entirely). A heading-aware chunker splits documents into
  sections: each chunk runs from an ATX heading to the next heading, its symbol
  is the heading breadcrumb (`Install > Prerequisites`), content before the
  first heading is an unnamed preamble section, `#` inside fenced code blocks
  does not split, and sections longer than 200 lines continue as extra chunks
  under the same symbol. New chunk kind `section` (accepted by the `kind`
  filter on `/search` and the search tools).

- **Index-aware search tools** — six new daemon tools over the chunk index and
  vector search, exposed via `POST /tools/call` and bridged to the agent
  (except `search`, which is hidden from the agent bridge because `search_code`
  already covers vector search with a compact shape):
  - `search` — semantic vector search (same engine as `GET /search`)
  - `get_chunk` — full indexed chunk body by `(repo, id)` from a search hit
  - `find_symbol` — case-insensitive exact symbol lookup in the chunk table
    (works without vector search)
  - `file_outline` — indexed chunks in a file with line ranges
  - `hybrid_search` — vector candidates reranked by lexical term matches in
    hit files (one file read per unique path, not per term)
  - `find_references` — word-boundary grep for symbol usages across the repo
- **C indexer IPC** — new commands `chunk`, `symbol`, and `outline`; extended
  `search` with optional `path_glob`, `kind`, and `min_score` filters;
  `status` now reports `vectors_enabled`.
- **Search filters on HTTP** — `GET /search` accepts `path_glob`, `kind`, and
  `min_score` query parameters alongside existing `q`, `k`, and `repo`.
- **Structured daemon errors** — failed `/search` and `/tools/call` responses
  return `{"ok":false,"code":"…","message":"…"}` with stable machine-readable
  codes (`NOT_FOUND`, `INVALID_ARGS`, `NOT_IMPLEMENTED`, etc.).
- **Agent search improvements** — `search_code` exposes `score` and supports
  `path_glob`, `kind`, and `min_score`; `DaemonClient.waitReady()` polls until
  the indexer is ready; `DaemonError` carries HTTP status and error codes from
  the daemon.
- **Agent prompt strategy** — documents chunk-first workflow (`search_code` →
  `get_chunk` → `read_file` when chunk span is insufficient), symbol lookup,
  hybrid search, and reference finding.

### Changed

- **Daemon package layout** — responsibilities split for clarity:
  - `bootstrap` — startup timeout and indexer readiness polling
  - `domain` — shared `Repo{Key, Root}` type
  - `indexctl` — `Indexer` interface; IPC split into `wire.go` + `transport.go`
  - `subprocess` — safe pipeline and sed script validation/execution
  - `search` — hybrid reranking helpers
  - `git` — git subprocess runner
  - `httpserver` — centralized HTTP error mapping and response helpers
  - `testutil` — shared daemon test fixtures
- **Go idiomatic cleanup** — tool arg/result structs hoisted to package level;
  blank lines between logical blocks in methods; typed result structs instead of
  `map[string]any`.
- **Agent deduplication** — shared `chunkKey()`, `codebergHome()`, and
  `lastUserMessage*` helpers; `listTools` uses `DaemonError` like other client
  methods; startup only swallows `NOT_READY` from `waitReady` (other errors
  propagate).
- **`workspace.Tree` skip list** — aligned with C `cberg_walk_skip_dir`
  (`.git`, `node_modules`, `vendor`, `build`, etc., not just `.git`).
- **Compact JSON** — daemon HTTP responses no longer pretty-print every payload.
- **Core tests** — `core/test/test_common.h` added for shared `CHECK` macro
  (migration of individual test files pending).

### Fixed

- **Hybrid search performance** — reranking reads each hit file once (content
  cache) instead of spawning `rg` per candidate × query term.
- **Misplaced grep in hybrid** — term matching uses file content reads scoped
  to the hit path, not `path_glob` passed where a file path was expected.

  is remembered in `~/.codeberg/repos` (list with `codeberg repos`), and
  `codeberg --all [--web]` boots one daemon over all of them: a single
  `cberg-index` process shares one embedding model across per-repo chunk
  tables/watchers/vector indexes, warm-starting each repo from its existing
  `<base>.<roothash>` files. Searches fan out across ready repos and merge by
  score — or scope to one with `search_code`'s new `repo` arg / `GET
  /search?repo=key` — and results, the evidence ledger, and the web UI's source
  cards now carry the repo key. `codeberg <dir>` works as a shorthand for
  `--root <dir>` and registers the repo; file tools' previously-ignored `repo`
  parameter now resolves against the served repos (new `repos` tool lists them).
  Single-repo behavior and on-disk index layout are unchanged.
- **`--repos` and `--no-index`** — `codeberg --repos <dir|key>,…` serves a chosen
  set of directories and/or registered repo keys together (a scoped `--all`;
  directories get registered like any run). `--no-index` makes any run a
  one-off: nothing is added to the registry and no vector index is built or
  reused — file tools and chat work over the root(s), semantic search is off
  for that session, and nothing lands on disk. Both compose with `--web`, and
  are also settable as `CODEBERG_REPOS` / `CODEBERG_NO_INDEX`.
- **Saved, resumable web chats** — the browser UI persists each completed turn to
  `<CODEBERG_HOME>/web-sessions/<id>.json` (UI messages verbatim, so a resume
  re-renders with full fidelity) behind a small CRUD API (`GET /api/sessions`,
  and `GET`/`PUT`/`DELETE /api/sessions/<id>`). A toggleable sidebar lists saved
  chats newest-first to resume, delete, or start a new one. Kept separate from the
  TUI's `ModelMessage` session store, which doesn't convert losslessly.
- **Collapsible search results in the web UI** — `search_code` results fold into
  the same disclosure used for reasoning and tool panels (default-open, since the
  hits are the primary surface), with the count and query as the summary.
- **Browser chat UI from the launcher** — `codeberg --web` boots the same stack
  but serves the chat in a browser (via `codeberg-web`) instead of the terminal
  TUI, opening `http://127.0.0.1:48088` once the daemon is healthy. It defaults to
  an uncommon high port (not the much-contended 3000), grouped just past the
  daemon's 48080 and below the ephemeral range; override with `--web-port` /
  `CODEBERG_WEB_PORT`, or make web the default with `CODEBERG_WEB=true`. The
  launcher builds the React SPA (`make build-web-ui`) on first `--web` run so the
  rich UI shows rather than the embedded fallback page.
- **`launcher/update.sh`** — rebuilds the components (core+daemon, agent, web UI)
  and relinks `codeberg` in place, so code changes take effect without an
  uninstall/reinstall cycle.
- **llama.cpp provider** — a `llamacpp` model provider targets a local
  `llama-server` over its OpenAI-compatible API (default
  `http://localhost:8080/v1`, override with `LLAMACPP_BASE_URL`). Like `ollama`
  it needs no API key; the model id is a free-form label since llama-server
  serves whatever was loaded with `-m` (e.g. `CODEBERG_MODEL=llamacpp:my-model`).
- **Fast restarts via persisted state** — `cberg-index` now saves the chunk table
  and merkle manifest as sidecars next to the vector index. On restart it restores
  them, so chunk ids stay stable and the reopened index reuses existing embeddings;
  the manifest diff re-chunks only the files that changed while the process was
  down. A restart with no changes re-embeds nothing and reads no source files. New
  ABI: `cberg_chunk_table_save`/`_load` and `cberg_manifest_save`/`_load`.
- **Per-directory index state** — `CBERG_INDEX_PATH` is now a base path; the index
  and its sidecars are keyed by a hash of the resolved root
  (`<base>.<roothash>[.chunks|.manifest]`). Pointing the indexer at a different
  tree never reuses another tree's chunks, and reverting to a prior tree finds its
  embeddings still cached.
- **Agent run statistics** — `agent.ask` now returns `performance` (output
  tokens/sec, response time) from ai-sdk's `finalStep.performance`, surfaced as a
  `--- N tok/s · Ns ---` line under `codeberg-ask` answers.
- **Reasoning control** — `CODEBERG_REASONING` (`provider-default|none|minimal|low|
  medium|high|xhigh`) sets reasoning effort for reasoning-capable models via
  ai-sdk's standardized `reasoning` option.
- **Daemon `pipe` tool** — runs a read-only pipeline over the repo in one call,
  chaining `rg`/`grep` with text filters (`head`, `tail`, `wc`, `sort`, `uniq`,
  `cut`, `tr`, `nl`, `cat`, `paste`, `sed`) using `|`, so the agent can search and
  filter in a single round-trip instead of several tool calls. No shell is invoked:
  the command is tokenized and each stage exec'd directly rooted at `CODEBERG_ROOT`;
  redirection/substitution/`;`/`&` and write/exec flags (`rg --pre`, `sort -o`,
  `sed -i`) are rejected, paths cannot escape the root, and `awk`/`xargs` are
  excluded. Output is bounded and the run is time-limited. The agent picks it up
  automatically via `GET /tools`.
- **Prebuilt "dist" mode for the launcher** — `codeberg` can run from a prebuilt
  tree instead of a source checkout: `make dist` assembles a relocatable `bin/` +
  `libexec/` payload (binaries, agent bundle + production `node_modules`, scripts),
  and the launcher locates it at `../libexec` relative to its own binary — so it
  works wherever it's extracted, with no baked path (override with
  `--dist`/`CODEBERG_DIST`). `codeberg doctor` reports which root it resolved. This
  is the groundwork for packaged installers; the clone + `make` developer flow is
  unchanged.
- **Launcher dependency auto-install** — before building, `codeberg` now preflights
  the build prerequisites (a C toolchain + `make`, CMake, Go ≥ 1.22, Node ≥ 22 +
  npm, `git`, and the ONNX Runtime library) and installs the missing ones via
  Homebrew (macOS) or apt (Linux), instead of failing deep in `make` with output
  that never named the package. `codeberg doctor` reports the ONNX runtime too, and
  `CODEBERG_SKIP_DEP_INSTALL=1` checks without installing. The README now documents
  the full prerequisite list per platform.

### Changed

- **`make build` renamed to `make build-core`** — symmetric with `build-daemon`
  and `build-agent`. `make build` stays as a back-compat alias, so existing
  scripts, CI, and habits keep working.
- **Daemon health-check timeout raised 6m → 15m** — a cold first index of a large
  tree (chunk + embed every file) routinely ran past six minutes, tripping the
  launcher's wait and forcing a second `codeberg` run. The default is now 15
  minutes and is overridable with `CODEBERG_HEALTH_TIMEOUT` (any Go duration).

- **Agent upgraded to ai-sdk v7** — the hand-rolled `generateText` + `stepCountIs`
  tool loop is now a built-once `ToolLoopAgent` with `TimeoutConfiguration`
  (`totalMs`/`stepMs`/`chunkMs`) bounding stalled gateways. Provider packages move
  to their v7-compatible majors (`@ai-sdk/openai-compatible@3`, `anthropic@4`,
  `openai@4`, `google@4`).
- **TUI replaced with `runAgentTUI`** — the interactive `codeberg-tui` now uses
  `@ai-sdk/tui` (streamed tool calls, collapsible reasoning, live tok/s) instead of
  the bespoke Ink UI. The custom prompt history and the old `/help` `/clear`
  `/copy` `/quit` commands are dropped; `runAgentTUI` exposes no command hooks
  of its own, so persistent sessions and a new `/help` `/sessions` `/resume`
  `/new` set are layered back on by wrapping the agent it drives (see
  [agent/README.md](agent/README.md#session-commands)). Neither the TUI nor
  the CLI take a seeded-question flag — the CLI is single-shot by construction
  (`codeberg-ask [provider:model] <question>`) and the TUI is always
  interactive.

### Fixed

- **`web_search` setup could fail silently on Debian/Ubuntu with a bare `python3`
  binary check** — the dependency preflight only confirmed `python3`/`python`
  was on PATH, but Debian/Ubuntu strip `ensurepip`'s bundled wheels from the
  base `python3` package, so a venv built from it has no pip until
  `python3-pip` is installed too; `python3-venv` alone is not sufficient. The
  managed SearXNG install would then fail deep in `pip install SearXNG
  requirements` with a confusing error. `deps.EnsurePython` now checks for a
  *working* pip (`python3 -m pip --version`) and installs `python3-pip`
  automatically on apt hosts; the README's prerequisites table lists both
  packages.
- **`codeberg uninstall` left the command on PATH** — removal only scanned a
  hardcoded set of directories, so a `codeberg` installed anywhere else on `$PATH`
  (e.g. `/opt/homebrew/bin`, a custom bin dir, or another checkout's symlink) was
  silently missed. It now scans every `$PATH` directory, offers to remove a second
  or stale codeberg it didn't launch from (auto-removed under `--yes`), and notes
  that a just-removed command can linger in the shell's command-location cache
  until `hash -r` / `rehash`.
- **Agent provider packages missing at runtime** — `@ai-sdk/anthropic`, `@ai-sdk/
  google`, and `@ai-sdk/openai` were declared as `optionalDependencies` but are
  statically imported (and externalized from the bundle), so an install that
  skipped optionals left the agent unable to start for those providers. They are
  now regular `dependencies`.
- **Re-embedding the whole corpus on every restart** — the chunk table was rebuilt
  empty at startup, so bootstrap treated every chunk as new and re-embedded it.

## [0.1.0] - 2026-06-22

### Added

- **libcodeberg** — standalone C indexing library: tree-sitter chunking (Go,
  TypeScript, JavaScript, C, Kotlin, Python, Java) with windowed fallback;
  incremental chunk table with stable ids; XXH3-128 content hashing and set
  fingerprint; filesystem watcher (Linux inotify / macOS FSEvents) as the sole
  indexing trigger.
- **Embedding and search** — optional ONNX Runtime path with jina-embeddings-v2-base-code
  (768-dim) via onnxruntime-extensions tokenizer; usearch HNSW cosine index and
  `cberg_search_query` nearest-neighbor lookup.
- **Configuration** — `CODEBERG_ROOT` environment variable and `cberg_config_*`
  helpers; symlink roots and in-tree symlinks supported.
- **Documentation** — `core/docs/` (architecture, full public API, per-module
  internals, ADRs); project `docs/` index.
- **Build and test** — top-level Makefile, CMake build, ctest suite
  (`test_smoke`, chunker, watcher, index; embed/search when `CBERG_TEST_MODEL`
  is set).
- **Community** — MIT license, contributing guide, security policy, changelog,
  and release process (`VERSION` as single source of truth).
