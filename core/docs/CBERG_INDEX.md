# `cberg-index` — multi-root indexer

The `cberg-index` binary (`core/cmd/cberg-index/`) links `libcodeberg` and runs the
full indexing loop for one or many repository roots in a single process. The Go
`codeberg-d` daemon supervises it and talks to it over a Unix socket — see
[daemon/docs/ipc.md](../../daemon/docs/ipc.md).

**Implementation header:** `core/cmd/cberg-index/indexer.h`  
**Design rationale:** [adr/0004-multi-root-engine.md](adr/0004-multi-root-engine.md)

---

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `CODEBERG_ROOT` | yes¹ | Single repository root (key = basename) |
| `CODEBERG_ROOTS` | yes¹ | `key\tpath` records, newline-separated (multi-repo; supersedes `CODEBERG_ROOT`) |
| `CBERG_MODEL` | for vectors | Path to ONNX `model.onnx` |
| `CBERG_INDEX_PATH` | for vectors | **Base** path for per-repo index files |
| `CBERG_SOCKET` | no | Unix socket for IPC (default `/tmp/codeberg-index.sock`) |
| `CBERG_POLL_MS` | no | Watcher idle sleep between steps (default 1000) |
| `CBERG_EMBED_THREADS` | no | ONNX intra-op thread cap (inherited env) |
| `CBERG_EMBED_COREML` | no | Apple Silicon CoreML provider opt-in |

¹ Exactly one of `CODEBERG_ROOT` / `CODEBERG_ROOTS`. Unresolvable roots are skipped
with a warning.

Without `CBERG_MODEL` and `CBERG_INDEX_PATH` the engine runs in **chunk-only mode**
(chunk table + manifest + watcher; no vectors).

---

## Process architecture

```mermaid
flowchart TB
  subgraph engine [cberg_engine — one per process]
    CH[cberg_chunker]
    EM[cberg_embedder + embed_mu]
    IPC[Unix socket IPC thread]
  end

  subgraph repo1 [cberg_repo per root]
    T1[chunk table]
    M1[manifest]
    W1[watcher]
    I1[vector index]
  end

  subgraph repo2 [cberg_repo ...]
    T2[chunk table]
    M2[manifest]
    W2[watcher]
    I2[vector index]
  end

  engine --> repo1
  engine --> repo2
  CH --> repo1
  CH --> repo2
  EM --> repo1
  EM --> repo2
```

- **One embedder** per process (expensive, not thread-safe) — all `cberg_embedder_embed`
  calls go through `embed_mu`.
- **Per-repo state:** chunk table, manifest baseline, watcher, vector index, mutex.
- **Main thread:** bootstrap each repo, then `cberg_engine_run` (watch loop).
- **IPC thread:** search requests only; embeds the query once, searches each repo's
  index under that repo's mutex, merges hits by score.

**Lock order:** `repo->mu` → `embed_mu` during indexing; search takes `embed_mu` alone
for query embed, then one `repo->mu` at a time. Never `embed_mu` → `repo->mu`.

---

## Lifecycle

### 1. Open

`cberg_engine_open` reads env, resolves roots, optionally opens ONNX embedder.

### 2. Bootstrap (per repo)

For each `cberg_repo`:

1. Try `cberg_chunk_table_load`, `cberg_manifest_load`, `cberg_index_open` from sidecars.
2. On `NOT_FOUND` or first run → cold walk: parse every file, `sync`, embed all chunks.
3. Open watcher on repo root; mark `ready` when bootstrap completes.

Startup is **sequential** across repos (one bootstrap at a time).

### 3. Watch loop

```
loop until SIGINT/SIGTERM:
    for each repo:
        poll watcher → dirty paths
        re-chunk dirty files → sync → embed added∪modified, remove deleted ids
        save sidecars (chunk table, manifest, index)
    sleep poll_ms when idle
```

### 4. IPC

While the watch loop runs, the IPC thread serves `status`, `search`, and related
requests. Multi-repo search embeds the query once, calls `cberg_search_vector` per
index, merges results.

---

## On-disk artifacts

Given `CBERG_INDEX_PATH=/tmp/codeberg.usearch` and a repo root, paths derive from
a hash of the resolved root:

| File | Contents | Magic |
|------|----------|-------|
| `<base>.<roothash>` | usearch HNSW index (vectors by chunk id) | usearch format |
| `<base>.<roothash>.chunks` | Serialized chunk table (ids, keys, hashes) | `CBT1` v1 |
| `<base>.<roothash>.manifest` | Serialized manifest leaves | `CBMF` v1 |

Changing `CODEBERG_ROOT` to a different tree produces a different `<roothash>` —
caches never collide. Reverting to a prior root reuses its sidecars for warm start.

`cberg_chunk_table_save` / `load` and `cberg_manifest_save` / `load` use atomic
temp+rename. Incompatible versions return `CBERG_ERR_NOT_FOUND` → cold rebuild.

---

## Build and run

```sh
make build-core    # produces core/build/bin/cberg-index
export CODEBERG_ROOT=/path/to/repo
export CBERG_MODEL=models/jina-embeddings-v2-base-code/model.onnx
export CBERG_INDEX_PATH=/tmp/codeberg.usearch
./core/build/bin/cberg-index
```

Normally `codeberg-d` spawns and supervises `cberg-index` — see
[daemon/README.md](../../daemon/README.md).
