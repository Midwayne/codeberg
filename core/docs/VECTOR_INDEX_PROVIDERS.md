# Vector index providers

Codeberg stores embedding vectors behind a pluggable backend. Chunk metadata
(ids, paths, symbols, hashes) is **always local**; only the float vectors move
when you switch backends.

| Layer | Where it lives | Survives restart? |
|-------|----------------|-------------------|
| Chunk table | `<index_path>.chunks` | yes (local disk) |
| Merkle manifest | `<index_path>.manifest` | yes (local disk) |
| Vectors | usearch file, Qdrant collection, or pgvector table | yes (per backend) |

**Related docs:** [CBERG_INDEX.md](CBERG_INDEX.md) (indexer lifecycle),
[TESTING.md](TESTING.md) (integration tests), [daemon/README.md](../../daemon/README.md)
(daemon env passthrough).

---

## Quick start

All backends need ONNX embedding enabled:

```sh
export CBERG_MODEL=models/jina-embeddings-v2-base-code/model.onnx
export CBERG_INDEX_PATH=/tmp/codeberg.usearch   # base path; see “Per-repo layout”
export CODEBERG_ROOT=/path/to/repo
```

Pick a backend with `CBERG_INDEX_BACKEND` (default: `usearch`).

### usearch (default — local file)

No extra setup. Vectors are stored in a usearch HNSW file next to the chunk
sidecars.

```sh
# CBERG_INDEX_BACKEND unset, or:
export CBERG_INDEX_BACKEND=usearch
make run-daemon
```

### Qdrant

```sh
export CBERG_INDEX_BACKEND=qdrant
export CBERG_VECTORDB_URL=http://127.0.0.1:6333          # or https://cluster.qdrant.io
export CBERG_VECTORDB_API_KEY=your-key                   # optional; required for Qdrant Cloud
make run-daemon
```

### pgvector

```sh
export CBERG_INDEX_BACKEND=pgvector   # alias: postgres
export CBERG_POSTGRES_URL=postgresql://user:pass@host:5432/dbname
make run-daemon
```

Copy any of the above into `daemon/.env` — see
[daemon/.env.example](../../daemon/.env.example).

---

## Configuration reference

### Environment variables

| Variable | Backends | Required | Purpose |
|----------|----------|----------|---------|
| `CBERG_MODEL` | all | yes (for vectors) | Path to ONNX `model.onnx` |
| `CBERG_INDEX_PATH` | all | yes (for vectors) | **Base** path for per-repo index identity and local sidecars |
| `CBERG_INDEX_BACKEND` | all | no | `usearch` (default), `qdrant`, `pgvector` (`postgres` alias) |
| `CBERG_VECTORDB_URL` | qdrant | yes | Qdrant REST base URL (no trailing path) |
| `CBERG_VECTORDB_API_KEY` | qdrant | no | Sent as `api-key` header (Qdrant Cloud) |
| `CBERG_POSTGRES_URL` | pgvector | yes | libpq connection string |

The daemon forwards these to `cberg-index` unchanged. The C API mirrors them in
`cberg_index_config` (`vectordb_url`, `vectordb_api_key`, `postgres_url`).

### Provider comparison

| | usearch | Qdrant | pgvector |
|---|---------|--------|----------|
| **Storage** | Local HNSW file | Remote collection | PostgreSQL table |
| **Best for** | Single machine, zero deps | Managed vector DB, horizontal scale | Existing Postgres ops, SQL tooling |
| **Build deps** | vendored usearch | libcurl for `https://` | libpq + pgvector extension |
| **Incremental updates** | add/remove + periodic save | REST upsert/delete | SQL upsert/delete |
| **HNSW tuning** | `connectivity`, `expansion_*` in config | Qdrant defaults | sequential scan (no HNSW index yet) |
| **Multi-repo** | one file per repo | one collection per repo | one table per repo |

---

## Per-repo layout

`CBERG_INDEX_PATH` is a **base**, not a single index file. For each served
repository root, `cberg-index` derives:

```
<roothash> = first 16 hex digits of SHA-256(resolved_repo_root)
<index_path> = <CBERG_INDEX_PATH>.<roothash>
```

| Artifact | Path | Contents |
|----------|------|----------|
| usearch index | `<index_path>` | HNSW vectors keyed by chunk `uint64_t` id |
| Chunk table | `<index_path>.chunks` | Serialized chunks (`CBT1`) |
| Manifest | `<index_path>.manifest` | Merkle leaves (`CBMF`) |
| Qdrant collection | `codeberg_<16hex>` | Vectors; name from hash of `<index_path>` |
| pgvector table | `codeberg_<16hex>` | Vectors; name from hash of `<index_path>` |

Example with `CBERG_INDEX_PATH=/data/codeberg.idx` and repo `/srv/api`:

```
/data/codeberg.idx.a1b2c3d4e5f67890           # usearch file (if backend=usearch)
/data/codeberg.idx.a1b2c3d4e5f67890.chunks
/data/codeberg.idx.a1b2c3d4e5f67890.manifest
# remote: collection/table codeberg_<hash-of-full-index-path>
```

Changing `CODEBERG_ROOT` to a different tree yields a different `<roothash>` —
caches never collide. Reverting to a prior root reuses its sidecars and remote
collection/table for a warm start.

**Multi-repo:** each entry in `CODEBERG_ROOTS` gets its own `<roothash>`,
sidecars, and remote collection/table. All repos share one `CBERG_INDEX_PATH`
base and one remote server URL.

---

## Server setup

### usearch

No server. Ensure the directory containing `CBERG_INDEX_PATH` is writable and
has enough disk for the HNSW file (roughly proportional to chunk count ×
embedding dimension).

### Qdrant

**Docker (local dev / CI):**

```sh
docker run -d --name qdrant -p 6333:6333 qdrant/qdrant:latest
export CBERG_VECTORDB_URL=http://127.0.0.1:6333
```

**Qdrant Cloud:** create a cluster, copy the cluster URL and API key:

```sh
export CBERG_VECTORDB_URL=https://xxxxxxxx.aws.cloud.qdrant.io
export CBERG_VECTORDB_API_KEY=your-api-key
```

**HTTPS note:** the Qdrant backend needs **libcurl** at build time for
`https://` URLs. `http://` works without curl (plain socket HTTP client).

Health check: `curl -s http://127.0.0.1:6333/readyz`

### pgvector

**Docker (local dev / CI):**

```sh
docker run -d --name pgvector \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=codeberg \
  -p 5432:5432 \
  pgvector/pgvector:pg16

export CBERG_POSTGRES_URL=postgresql://postgres:test@127.0.0.1:5432/codeberg
```

**Existing PostgreSQL:** install the [pgvector](https://github.com/pgvector/pgvector)
extension on the server. Codeberg runs `CREATE EXTENSION IF NOT EXISTS vector`
on first open — the database user needs permission to create extensions (or
pre-create the extension as a superuser).

**Managed Postgres (RDS, Cloud SQL, etc.):** enable the pgvector extension in
the provider console, then point `CBERG_POSTGRES_URL` at that database.

---

## Remote schemas (auto-created)

Codeberg creates remote storage on `cberg_index_open`. You do not need to
create collections or tables manually.

### Qdrant collection

| Property | Value |
|----------|-------|
| Name | `codeberg_<16hex>` (hash of `<index_path>`) |
| Vector size | embedding model dimension (768 for jina-embeddings-v2-base-code) |
| Distance | Cosine |
| Point id | chunk `uint64_t` id |

Equivalent REST body on create:

```json
{"vectors": {"size": 768, "distance": "Cosine"}}
```

Upserts use `PUT /collections/{name}/points?wait=true`. Search uses the
collection search API; scores are converted to cosine similarity
(`1 - distance`).

If a collection exists with a **different dimension**, open fails with
`CBERG_ERR_IO` and triggers corrupt-index recovery (see below).

### pgvector table

On first open for a repo:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS codeberg_<16hex> (
  id BIGINT PRIMARY KEY,
  embedding vector(<dim>)
);
```

| Column | Type | Notes |
|--------|------|-------|
| `id` | `BIGINT` | chunk `uint64_t` id |
| `embedding` | `vector(dim)` | float32 embedding |

Writes use `INSERT ... ON CONFLICT (id) DO UPDATE`. Search orders by cosine
distance (`<=>` operator) and returns `1 - distance` as the score.

If a table exists with a **different `vector(dim)`**, open fails and triggers
recovery.

**Indexes:** Codeberg does not create an HNSW or IVFFlat index on pgvector
tables today. Search is an ordered sequential scan — fine for development and
moderate corpora; for large production indexes, add an index manually:

```sql
CREATE INDEX ON codeberg_<16hex> USING hnsw (embedding vector_cosine_ops);
```

---

## Build requirements

| Backend | CMake / packages | Behavior when missing |
|---------|------------------|----------------------|
| usearch | always (vendored) | — |
| qdrant | optional `libcurl4-openssl-dev` | `https://` URLs return `NOT_IMPLEMENTED`; `http://` still works |
| pgvector | optional `libpq-dev` + server with pgvector | backend returns `NOT_IMPLEMENTED` |

Ubuntu / Debian:

```sh
sudo apt install libcurl4-openssl-dev libpq-dev
CC=gcc CXX=g++ make build
```

The cloud `.cursor/Dockerfile` and CI install these headers so all backends
build in CI.

---

## Operations

### Switching backends

Chunk sidecars are backend-agnostic. To migrate vectors:

1. Stop `cberg-index` / `codeberg-d`.
2. Set the new `CBERG_INDEX_BACKEND` and connection env vars.
3. Delete local sidecars for the repo **or** let recovery run (see below).
4. Restart — cold bootstrap re-embeds all chunks into the new backend.

Keeping `.chunks` / `.manifest` avoids re-parsing the tree; only embeddings are
recomputed.

### Corrupt-index recovery

On startup, if `cberg_index_open` returns `CBERG_ERR_IO` (corrupt usearch
file, unreachable remote DB, dimension mismatch), `cberg-index`:

1. Logs a warning and calls `cberg_index_wipe` for that repo.
2. Deletes `<index_path>.chunks` and `<index_path>.manifest`.
3. Reopens the index and cold-reindexes from the repository.

| Backend | `cberg_index_wipe` action |
|---------|---------------------------|
| usearch | deletes the on-disk index file |
| qdrant | `DELETE /collections/{name}` |
| pgvector | `DROP TABLE IF EXISTS codeberg_<16hex>` |

Remote vectors from a previous run are removed on wipe — plan backups if you
manage collections/tables outside Codeberg.

### Incremental indexing

After bootstrap, the watch loop applies chunk diffs:

- **added / modified** → embed → upsert vector by chunk id
- **deleted** → remove vector by chunk id
- **save** → usearch flushes to disk; Qdrant/pgvector are no-ops (already persisted)

### usearch-only tuning

`cberg_index_config` HNSW fields apply only to usearch:

| Field | Default | Effect |
|-------|---------|--------|
| `connectivity` | 16 | graph degree |
| `expansion_add` | 128 | insert quality (efConstruction) |
| `expansion_search` | 64 | query efSearch baseline |

`cberg_search_query` temporarily raises `expansion_search` for semantic search.
Remote backends ignore per-query expansion today.

---

## Testing

### Unit / harness

```sh
make test TEST=test_index          # usearch only
```

### All providers (integration)

```sh
make test-index-providers
```

This script starts ephemeral Docker Qdrant + pgvector when URLs are unset, then
runs `test_index_providers`.

Manual URLs (no Docker):

```sh
export CBERG_TEST_QDRANT_URL=http://127.0.0.1:6333
export CBERG_TEST_POSTGRES_URL=postgresql://postgres:test@127.0.0.1:5432/codeberg
make test TEST=test_index_providers
```

CI runs the same suite in the `index-providers` job (service containers for
Qdrant and pgvector). See [TESTING.md](TESTING.md).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `unknown CBERG_INDEX_BACKEND` | typo | use `usearch`, `qdrant`, `pgvector`, or `postgres` |
| `CBERG_VECTORDB_URL is required` | backend=qdrant without URL | set URL |
| `CBERG_POSTGRES_URL is required` | backend=pgvector without URL | set connection string |
| `NOT_IMPLEMENTED` on Qdrant HTTPS | built without libcurl | install libcurl dev package, rebuild |
| `NOT_IMPLEMENTED` on pgvector | built without libpq | install libpq-dev, rebuild |
| `vector index ... unreadable; discarding` | corrupt file, DB down, dim mismatch | fix infra; allow reindex |
| pgvector `CREATE EXTENSION` fails | insufficient DB privileges | pre-create extension as superuser |
| Slow pgvector search at scale | no ANN index | add HNSW/IVFFlat index manually |

---

## Implementation map

```
core/src/search/
  index.c                     # public cberg_index_* facade
  providers/
    registry.c                # dispatch by CBERG_INDEX_BACKEND name
    common.c                  # codeberg_<16hex> naming
    usearch/usearch.c
    qdrant/qdrant.c + http_client.c
    pgvector/pgvector.c
```

Public ABI: `cberg_index_provider`, `cberg_index_config`, `cberg_index_wipe`,
`cberg_index_clear` in `include/codeberg/codeberg.h`.
