# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-v1, breaking
changes may occur in minor releases and are called out explicitly.

## [Unreleased]

### Added

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
  the bespoke Ink UI. The custom prompt history, `/help` `/clear` `/copy` `/quit`
  commands, and the TUI's `--once` / seeded-question flags are dropped; the CLI
  keeps `--once` and seeded questions.

### Fixed

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
