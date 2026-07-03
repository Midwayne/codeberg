# 4. Multi-root engine: one process, one embedder, per-root state

Status: accepted

## Context

`cberg-index` served exactly one directory: a static `cberg_indexer` singleton
holding the root, chunk table, manifest, watcher, HNSW index, and the ONNX
embedder. `codeberg --all` needs one daemon session to search **many**
registered repositories combined, scoped per repo or across all of them, while
keeping indexing on-demand and warm starts per repo.

Two shapes were considered:

- **N processes, one per repo.** No C changes, crash isolation — but every
  process loads its own copy of the embedding model (hundreds of MB of RAM
  each), and the daemon grows a socket-per-repo fan-out layer.
- **One process, N roots.** One embedder shared by every repo; requires
  breaking up the singleton, multiplexing the watch loop, and adding repo
  scoping to search and the IPC protocol.

[ADR 0003](0003-merkle-manifest-change-detection.md) already made change
detection per-repository, anticipating exactly this direction.

## Decision

Rework the cmd into a **multi-root engine** (`cberg_engine` + `cberg_repo`,
`core/cmd/cberg-index/indexer.h`):

- **Engine (process-wide):** the ONNX embedder (one per process, every call
  serialized through `engine_embed()` under `embed_mu`), the chunker, the IPC
  socket, poll cadence, and the repo list. Roots come from `CODEBERG_ROOTS`
  (`<key>\t<path>` records, newline-separated — the launcher registry's shape);
  `CODEBERG_ROOT` remains the single-root fallback with the basename as key.
  Unresolvable roots are skipped with a warning, never fatal.
- **Repo (per-root):** chunk table, manifest, watcher, HNSW index, `ready`
  flag, and its own mutex. On-disk layout is unchanged —
  `<CBERG_INDEX_PATH>.<roothash>` + `.chunks`/`.manifest` — so pre-existing
  indexes stay valid and `clean-index` needs no changes.
- **Lock order** is strictly `repo->mu -> embed_mu` (indexing) or each alone
  (search embeds the query under `embed_mu` only, then takes one `repo->mu` at
  a time). The raw `cberg_embedder_embed` call appears exactly once in the cmd.
- **Bootstrap is sequential** across repos: the shared embedder is the
  throughput bottleneck, so parallel bootstraps would only contend on
  `embed_mu`. A repo that fails to bootstrap stays not-ready (searches skip
  it; status reports it) instead of taking its siblings down; only losing every
  repo is fatal. Parallel chunk/parse with serialized embedding is a possible
  later optimization.
- **Watch loop** (`cberg_engine_run`) polls every repo's watcher non-blocking
  each pass and sleeps `poll_ms` only when idle. On the mtime-polling fallback
  platform this scans N trees per tick — acceptable at the target scale.
- **Search** embeds the query once and vector-searches each target index via
  the new `cberg_search_vector` (core API), merging hits by score. Scoped
  search (`repo` key) touches one index. Hits copy path/symbol/snippet out
  under the repo lock and carry the engine-owned repo key.

The **launcher registry** (`~/.codeberg/repos`, `<key>\t<path>` lines) is the
single source of truth for key→root; every `codeberg <dir>` run upserts into
it, and `--all` replays it. The daemon and engine receive the mapping and never
re-derive keys (except the single-root env fallback).

**IPC protocol v2** (`core/cmd/cberg-index/ipc.c`): `status` gains a per-repo
`repos` array; `search` accepts an optional 4th field (`search\t<q>\t<k>\t<repo>`)
parsed left-to-right; results gain a `repo` field. Old 3-field requests keep
working; consumers must treat `(repo, id)` as chunk identity since ids restart
at 1 per repo.

## Consequences

- One model copy in RAM regardless of repo count; a query embed can wait on an
  in-flight indexing batch (bounded by one `BATCH_SIZE` window).
- A supervisor restart in `--all` re-bootstraps all repos (warm — cheap);
  searches during that window skip not-ready repos and return partial results.
- Embedding dedup (`embed_unique`) stays per-repo per-sync; identical bodies in
  different repos embed twice. Cross-repo vector reuse would need a shared
  content-hash cache — out of scope here.
- The engine is single-writer per repo; per-repo mutexes keep search available
  while another repo indexes.
