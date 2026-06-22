# Indexer (`internal/indexer`)

## Flow

1. **Open** — resolve `CODEBERG_ROOT`, open chunker, chunk table, watcher; optionally embedder + usearch index.
2. **Bootstrap** — one-time `walk.Files` over the tree; chunk each file; `cberg_chunk_table_sync` full snapshot.
3. **Run** — block on `cberg_watcher_poll`; for each dirty path batch, rebuild incoming snapshot and sync.

## Incremental sync

`cberg_chunk_table_sync` expects a **full desired snapshot**: unchanged chunks are copied from
the live table, dirty paths are re-chunked, deleted paths are omitted so sync records deletions.

Vector updates run only on `changes.added` and `changes.modified`; `changes.deleted` removes
vectors by stable chunk `id`. Embedding runs before any index mutation. On failure the live
index file is left intact; recovery rebuilds into a staging file and atomically replaces it.

## Threading

The indexer holds a mutex across sync. HTTP search takes a read lock when vectors are enabled.
Do not call `Search` from multiple goroutines while modifying embedder state without the lock
(the server uses `RLock`).
