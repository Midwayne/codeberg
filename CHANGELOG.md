# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-v1, breaking
changes may occur in minor releases and are called out explicitly.

## [Unreleased]

### Added

- **Dynamic context discovery** — long tool results (one file per distinct
  body), terminal/pipe logs, and
  pre-summary transcripts are files under `$CODEBERG_HOME/context`. The agent
  reads them back with `context_grep`, `context_tail`, and `context_read`
  instead of keeping the full text in the prompt. Compaction still summarizes
  older turns and now points at the history file so later turns can recover
  paths, symbols, and command output. MCP descriptions and schemas live in
  one folder per server and are activated with `load_mcp_tools`; a server
  that fails to connect stays visible, including auth failures. Agent Skills
  (`SKILL.md`) contribute name and description until the agent opens the file.
- **Chat branching** — copy a conversation prefix into a new session
  without mutating the original. In the browser chat: **Branch from here**
  on a message or tick-rail preview, or **Branch chat** in the sidebar.
  Picking a user prompt includes its assistant reply so the branch starts
  on a complete turn. TUI: `/branch` (alias `/fork`). Branched sessions
  store `parentId`. Shared helpers live in `agent/src/core/branch.ts`;
  session ownership stays in the TUI wrapper and the web `Workspace`.
- **Chat message rail** — a ChatGPT-style tick rail on the right of the
  browser chat. Each tick is a user prompt: hover (or keyboard focus)
  previews the text, click/Enter jumps to that message. Ticks follow
  scroll position, spread apart when they would overlap, and the active
  one tracks the prompt currently in view. Hidden on narrow screens.
- **Built-in database MCP** — optional MongoDB, PostgreSQL, and Redis tools
  from the `third_party/multi-db-mcp-server` submodule. Off unless
  `CODEBERG_DBMCP_USE` is set. Put connections in `~/.codeberg/spec.yml`
  (`spec.yaml` also accepted). The agent registers `mcp_databases_<tool>` only
  after the server handshakes. Tool definitions come from the server. The
  system prompt tells the agent to find a query in the indexed code before
  executing it against a database, unless the user has explicitly defined the
  path to take. When the user asks for a new query, the agent drafts it from
  the indexed code, shows the statement and a plain description, prefers
  database indexes the code already uses, and asks before running it. `make build-dbmcp` builds
  `build/dbmcp`; `make update-dbmcp` pulls upstream `main` and rebuilds. See
  [docs/mcp.md](docs/mcp.md).
- **MCP server config** — the agent loads Cursor-compatible `mcp.json` files
  (`mcpServers`, with VS Code `servers` as an alias) and registers their tools
  as `mcp_<server>_<tool>`. Discovery, later files winning on the same name:
  `~/.codeberg/mcp.json`, each indexed root's `.cursor/mcp.json` then
  `.codeberg/mcp.json`, then `CODEBERG_MCP_CONFIG`. Stdio (`command`/`args`/
  `env`/`envFile`/`cwd`) and remote HTTP/SSE (`url`/`headers`/`type`) are
  supported, including `${env:NAME}` interpolation. A broken server is skipped
  so the rest of the agent keeps running. Disable with `CODEBERG_MCP_USE=false`.
  `codeberg config init` writes an empty `~/.codeberg/mcp.json`. See
  [docs/mcp.md](docs/mcp.md).
- **`config.example`** — comprehensive launcher/daemon/agent configuration
  reference at `launcher/internal/config/config.example`. `codeberg config init`
  writes a minimal starter file; see the example for every knob.
- **Comma-separated `CODEBERG_ROOT`** — pin one or more directories to index
  (`CODEBERG_ROOT=/a,/b`). The launcher and `codeberg-d` forward them as
  `CODEBERG_ROOTS` with registry-compatible repo keys.
- **Rust and Ruby chunking** — new vendored grammars `tree-sitter-rust`
  (v0.24.0) and `tree-sitter-ruby` (v0.23.1) with symbol-aware queries:
  Rust functions (including those in `impl` blocks), structs, enums (as
  `struct`), and traits (as `interface`); Ruby methods, singleton methods,
  classes, and modules (as `class`). Extensions `.rs`, `.rb`, `.rake`, and
  `.gemspec` now index as symbols instead of being skipped. Run
  `git submodule update --init --recursive` after pulling.
- **Markdown indexing** — `.md`/`.markdown` files are now chunked and indexed
  (previously skipped entirely). A heading-aware chunker splits documents into
  sections: each chunk runs from an ATX heading to the next heading, its symbol
  is the heading breadcrumb (`Install > Prerequisites`), content before the
  first heading is an unnamed preamble section, `#` inside fenced code blocks
  does not split, and sections longer than 200 lines continue as extra chunks
  under the same symbol. New chunk kind `section` (accepted by the `kind`
  filter on `/search` and the search tools).
- **Config-file indexing (YAML, TOML, JSON)** — `.yaml`/`.yml`, `.toml`, and
  `.json` files are now chunked and indexed (previously skipped entirely).
  Structural chunkers split them at top-level entries: YAML column-0 keys,
  TOML `[table]` / `[[array-of-tables]]` headers, and JSON root-object keys
  (bracket- and string-aware), each chunk named after its key. Content before
  the first entry is an unnamed preamble; entries longer than 200 lines
  continue as extra chunks under the same symbol (lock files); non-object JSON
  roots fall back to window chunks. New chunk kind `key` (accepted by the
  `kind` filter on `/search` and the search tools).
- **int8 vector quantization (usearch)** — stored vectors now quantize to
  int8 by default (`CBERG_INDEX_QUANT=i8`; set `f32` to opt out). New
  `quantization` field on `cberg_index_config` with
  `cberg_index_quant_from_name()`; the daemon forwards `CBERG_INDEX_QUANT` to
  `cberg-index`. Embeddings are L2-normalized, so int8's [-1,1] range is safe.
  Benchmarked at 50k×768 synthetic clustered vectors: ~3.5× smaller index files
  (46 MB vs 161 MB), ~3× faster inserts, ~2× faster search, recall@1 unchanged
  (1.0), recall@10 0.88 vs exact-f32 where the swapped items are near-ties
  (mean true-cosine loss 6e-4). **Existing f32 index files keep working** —
  a file's saved scalar kind wins on load; it adopts int8 on the next full
  rebuild. For new indexes where recall@k matters more than disk/CPU, set
  `CBERG_INDEX_QUANT=f32` before the first index build.
- **usearch i8 cosine bug workaround** — usearch v2.25.3's built-in i8 cosine
  metric returns distance 0 (a perfect match) for orthogonal vectors (the zero
  guard tests the dot product instead of the norms). i8 indexes register a
  corrected metric via `usearch_change_metric`.

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

- **`CODEBERG_ROOT` vs multi-repo** — when `CODEBERG_ROOT` is set, only the
  named path(s) are indexed. `--all` / `--repos` (`CODEBERG_ALL` /
  `CODEBERG_REPOS`) require an **unset** `CODEBERG_ROOT`; the two modes no
  longer combine (previously a configured root was silently ignored under
  `--all`). See [docs/multi-repo.md](docs/multi-repo.md#codeberg_root-vs-the-registry).
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

- **History compaction** — the verbatim older transcript is archived once. A
  summary that still overflows is trimmed without writing a second history file.
- **MCP tool descriptions** — the server prefix is copied onto the registered
  tool. Connecting again does not prefix the client's own description a second time.
- **Assistant tool results** — an oversized tool result carried on an assistant
  message is written to the same context file as a tool-role result.
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
