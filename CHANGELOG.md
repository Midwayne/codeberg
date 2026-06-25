# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-v1, breaking
changes may occur in minor releases and are called out explicitly.

## [Unreleased]

### Added

- **Fast restarts via persisted state** — `cberg-index` now saves the chunk table
  and merkle manifest as sidecars next to the vector index
  (`<index>.chunks`, `<index>.manifest`). On restart it restores them, so chunk
  ids stay stable and the reopened index reuses existing embeddings; the manifest
  diff re-chunks only the files that changed while the process was down. A restart
  with no changes re-embeds nothing and reads no source files. New ABI:
  `cberg_chunk_table_save`/`_load` and `cberg_manifest_save`/`_load`.

### Fixed

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
