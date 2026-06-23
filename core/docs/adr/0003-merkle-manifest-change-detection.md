# 3. Merkle manifest for content-derived change detection

Status: accepted

## Context

[ADR 0002](0002-watcher-driven-indexing.md) makes `cberg_watcher` the only
indexing trigger: filesystem events name the files to re-chunk. That holds well
for a single working tree, but the daemon's target is a directory of **many
mirrored repositories** (order of 100 repos × ~150 files), refreshed by scheduled
`git pull`. At that scale the watcher-only model has two failure modes:

- **inotify watch exhaustion.** Linux registers one watch descriptor per
  directory. Thousands of directories can exceed `fs.inotify.max_user_watches`,
  and a busy `git pull` can overflow the event queue. Both drop events
  **silently** — the index goes stale with no error.
- **No across-restart / two-snapshot diff.** After the process is down (or a pull
  lands while it is busy), the watcher cannot answer "what changed since the last
  index?" — it only reports events seen live.

A single flat chunk table across all repos would also make every edit pay a cost
proportional to the *total* corpus rather than the changed repo (see the
whole-corpus reconcile in `cberg_chunk_table_sync`).

## Decision

Add a **content-derived Merkle manifest** (`cberg_manifest`) as a change detector
that does not depend on filesystem events, used **per repository**.

- `cberg_manifest_build(root)` walks one repo, hashes every file body
  (XXH3-128) into leaves, and rolls directory hashes up via `cberg_fingerprint`.
  The root hash is a single digest over the whole tree.
- `cberg_manifest_root` gives an **O(1) "did this repo change at all"** gate —
  the natural cross-repo prune: skip the 99 repos whose root is unchanged.
- `cberg_manifest_diff(prev, next)` produces added / modified / deleted file
  lists, descending only into subtrees whose rollup hash differs.
- `cberg_manifest_rebuild(prev, root)` makes the steady state cheap: each leaf
  carries a `(size, mtime)` stat fingerprint, so a rebuild reads and hashes only
  the files that changed and reuses prior hashes for the rest — the git-index
  technique. Callers that poll on a schedule own the rolling baseline and may force
  an occasional full rebuild (`prev = NULL`) to bound stat-cache misses.

This **complements**, and does not remove, `cberg_watcher`. The watcher remains
the low-latency path for a live working tree; the manifest is the robust,
watch-free path for the many-repo daemon and for reconciling after downtime.

### How it plugs in

```
daemon (per repo, on a schedule)            core
────────────────────────────────           ────────────────────────────
git pull --ff-only                          cberg_manifest_build(repo) → next
  capture old/new revs                      if root(next) == root(prev): skip repo
                                            else cberg_manifest_diff(prev, next)
                                              → re-chunk modified ∪ added
                                              → purge chunks of deleted
                                              → next becomes the new baseline
```

`git diff --name-only <old> <new>` after a pull is an even cheaper exact change
list for the mirrored-repo path; the manifest is the fallback when no such
oracle exists (initial index, out-of-band writes, missed events) and the
integrity check that the two agree. One manifest **per repo** keeps the diff and
any downstream reconcile scoped to the repository that actually changed.

## Rationale

- **Watches are a bounded resource; content is not.** Re-hashing a tree needs
  zero kernel watches and cannot silently miss a change.
- **Hierarchy buys pruning.** Directory rollups let an unchanged subtree be
  dismissed by one hash compare, and unchanged repos by one root compare — the
  selective work that a flat per-file scan cannot express.
- **Reuse over novelty.** Leaves use `cberg_hash`; directory and root rollups use
  `cberg_fingerprint` — the same XXH3-128 order-independent digest already trusted
  for the chunk-set fingerprint. No new hash machinery, same collision profile.
- **Fast variant, not a crypto ledger.** This is a hash tree for *change
  detection*, not tamper resistance: XXH3 (not SHA), a flat arena-backed tree, and
  a linear path-sorted build. It buys pruning without the cost of a cryptographic
  Merkle tree.
- **The build, not the tree, was the cost.** The directory-rolled tree with a
  pruned diff is already efficient; the naïve part was re-reading every file each
  build. A stat-cache (`rebuild`) fixes that without changing the tree shape — the
  highest-leverage "faster Merkle" change, since hashing is fast and reads are not.

## Consequences

- `core/` gains `src/manifest/manifest.c` and the `cberg_manifest*` ABI in
  `codeberg.h`; `arena` gains `cberg_arena_alloc` for raw node allocation.
- The manifest decides *which files* to re-read; `cberg_chunk_table_sync` stays
  authoritative for *which chunks* changed (the [ADR 0002](0002-watcher-driven-indexing.md)
  division of labour is unchanged — only the file-level trigger is now pluggable).
- Wiring the daemon run-loop to drive per-repo manifests (and to feed
  `git diff` change lists into the indexer) is the follow-up integration step;
  this ADR establishes the core primitive and the per-repo model it assumes.
- The manifest is a snapshot: it detects change between two builds, it does not
  stream events. Latency is set by how often the daemon rebuilds, deliberately
  decoupled from the watcher's live path.
