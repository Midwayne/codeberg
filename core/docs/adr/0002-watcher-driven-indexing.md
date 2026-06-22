# 2. Watcher-driven indexing

Status: accepted

## Context

Incremental indexing needs a trigger: something must decide when to re-read files,
re-chunk, and update the vector index. Timers and cron schedules add latency, waste
work on idle repos, and duplicate what the filesystem already signals.

## Decision

**The core indexes only in response to filesystem changes** via `cberg_watcher`.
There is no scheduled, polled, or timer-based indexing path in `libcodeberg`.

The primary runtime loop is:

```
open watcher on repo root
optional one-time full walk to bootstrap the chunk table
forever:
    poll watcher → dirty paths
    re-chunk those paths → sync → embed/index changes
```

A one-time full walk at startup is bootstrap only (cold index before any events arrive).
It is not a recurring schedule.

### Daemon boundary

`daemon/` may run **scheduled `git pull`** to refresh a local mirror. That is source
delivery, not indexing. After `git fetch` / `reset` writes files, the watcher emits
the same events as a local edit. The core never needs to know a pull happened.

```
daemon (optional)          core (required for indexing)
─────────────────          ───────────────────────────
cron → git pull     →      files change on disk
                           → cberg_watcher fires
                           → chunk → sync → embed → index
```

The daemon must not call chunk/sync on a timer. It either embeds the watcher loop or
execs a binary that does.

## Rationale

- **Filesystem events are the ground truth** for “something on disk changed.”
- **Content-hash diff** (`cberg_chunk_table_sync`) still decides which chunks
  actually need re-embedding; the watcher only names candidate files.
- **Separation of concerns** — when to fetch upstream code (daemon schedule) vs when
  to index what is on disk (watcher) stay independent.

## Consequences

- `cberg-index` (phase 2 CLI) blocks on `cberg_watcher_poll`, not `sleep` + full tree walk.
- Remote-only change detection without a local working tree is out of scope for the core;
  the daemon must materialize commits to disk first.
- Tests that simulate indexing use file writes; the watcher test harness already follows
  this model.
