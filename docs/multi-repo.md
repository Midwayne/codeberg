# Multi-repo search

Codeberg indexes and searches **one or more** repositories from a single
`codeberg` session. Indexing stays on-demand — a directory is only indexed
once you run codeberg against it — and every root you've ever indexed is
remembered so you can search across all (or a chosen subset) of them combined.

For the design rationale and internals, see
[ADR 0004](../core/docs/adr/0004-multi-root-engine.md); for the wire protocols,
see [daemon/docs/ipc.md](../daemon/docs/ipc.md) and
[daemon/docs/http.md](../daemon/docs/http.md).

## Quick start

```sh
codeberg ~/projects/api          # index+search one repo (registers it)
codeberg ~/projects/frontend     # index+search another (registers it too)
codeberg --all                   # search both, combined, ranked by score
codeberg --repos api,frontend    # search just those two, by key
codeberg --repos ~/projects/api,~/scratch/experiment   # or by path — mix freely
codeberg ~/scratch --no-index    # one-off: not registered, no vector index built
codeberg repos                   # list every registered repo
```

`codeberg <dir>` is shorthand for `codeberg --root <dir>`. `--all` and `--repos`
compose with `--web` (`codeberg --all --web`).

## `CODEBERG_ROOT` vs the registry

There are **two mutually exclusive** ways to choose which repositories a
session indexes. You use one or the other — never both.

### Pinned roots (`CODEBERG_ROOT` set)

When `CODEBERG_ROOT` is set — in `~/.codeberg/config`, the environment, or via
`--root` — **only** the named directories are indexed. The repo registry is not
consulted and `--all` / `--repos` (or `CODEBERG_ALL` / `CODEBERG_REPOS`) are
rejected:

```sh
# one repo
CODEBERG_ROOT=~/projects/api
codeberg

# exactly two repos — comma-separated, no others
CODEBERG_ROOT=~/projects/api,~/projects/frontend
codeberg
```

Paths must not contain commas (no escape syntax). Each path is registered
(unless `--no-index`) and forwarded to the daemon as `CODEBERG_ROOTS`. A single
path also sets the `CODEBERG_ROOT` compat env var; multiple paths use
`CODEBERG_ROOTS` only. The C `cberg-index` binary does not split commas itself —
`codeberg-d` (or the launcher) expands the list before spawning it.

### Registry multi-repo (`CODEBERG_ROOT` unset)

When `CODEBERG_ROOT` is **unset**, roots come from the registry — every directory
you have previously run `codeberg <dir>` against (without `--no-index`):

```sh
codeberg ~/projects/api          # registers api
codeberg ~/projects/frontend     # registers frontend
# remove or comment out CODEBERG_ROOT in ~/.codeberg/config, then:
codeberg --all                   # index+search both, combined
codeberg --repos api,frontend    # same two, named explicitly
```

| `CODEBERG_ROOT` | `--all` / `--repos` | Indexed |
|-----------------|----------------------|---------|
| set (one path) | not allowed | that path only |
| set (comma list) | not allowed | exactly those paths |
| unset | `--all` | every registered repo |
| unset | `--repos a,b` | named subset from registry |

## The repo registry

Every repo you run `codeberg` against (without `--no-index`) is remembered in
`~/.codeberg/repos` — a plain text file, one `<key>\t<absolute path>` record
per line, `#` comments allowed, written atomically. It's the single source of
truth `--all` reads from; there's nothing to configure by hand, though you can
edit the file directly to drop a stale entry.

```sh
codeberg repos
#   ✓ api                       /Users/you/projects/api
#   ✓ frontend                  /Users/you/projects/frontend
#   ✘ old-thing                 /Users/you/archive/old-thing   (path gone)
```

A `✘` entry means the directory no longer exists on disk; `--all` skips it
with a warning rather than failing the whole run.

### Repo keys

A repo's **key** is how it's addressed everywhere — `--repos`, the `repo` tool
argument, search results, the evidence ledger, source cards in the web UI. It
defaults to the directory's **basename**; if two registered repos share a
basename (e.g. two different checkouts named `api`), the second gets a short
hash suffix (`api-a1b2c3`) so keys stay unambiguous. The key is derived once,
at registration, and stays stable across restarts and moves (as long as the
absolute path doesn't change).

## Modes

| Invocation | Roots served | Registered? | Vector index built? |
|---|---|---|---|
| `codeberg <dir>` / `--root <dir>` / `CODEBERG_ROOT` | that directory (or comma-separated list) | yes (unless `--no-index`) | yes (unless `--no-vector`) |
| `codeberg --all` (requires unset `CODEBERG_ROOT`) | every registered repo (skipping dead paths) | n/a (reads registry) | yes, per repo |
| `codeberg --repos a,b,...` (requires unset `CODEBERG_ROOT`) | the named dirs/keys | dirs get registered | yes, per repo |
| `--no-index` (with any of the above) | same roots | **no** | **no** |

`--all` and `--repos` are mutually exclusive (`--repos` is `--all` scoped to a
chosen subset). `--root` / `CODEBERG_ROOT` cannot combine with either — pin
explicit paths with `CODEBERG_ROOT` (comma-separated for several) or unset it
and use the registry. `--repos` accepts a mix of directory paths and
already-registered keys in one comma-separated list — an item is tried as a
directory first, then as a key.

### `--no-index`: leave no trace

`--no-index` makes a run session-only: the root(s) are **not** written to the
registry, and the C engine runs in chunk-only mode — no embedding model load,
no vector index files under `~/.codeberg/index`. File tools (`grep`,
`read_file`, `list_dir`, …) and chat still work over the root; **semantic
search (`search_code`) is unavailable for that session**. Useful for poking at
a one-off directory (a scratch clone, someone else's repo you're reviewing)
without polluting your registry or spending time embedding something you'll
never open again.

If the directory you pass to `--no-index` happens to already be registered,
its existing key is reused (so results stay consistently labeled); an
unregistered directory gets a session-only key derived the same way as a
registry entry, just never written to disk.

## How search behaves across repos

- **No `repo` given** (in `--all`/`--repos` mode): the query is embedded once
  and searched against every ready repo's index; hits are merged and ranked by
  score globally, then truncated to `k`. A repo still bootstrapping is skipped
  — you get partial results rather than an error.
- **`repo` given** (to `search_code`, `/search?repo=`, or file tools like
  `grep`/`read_file`): scoped to that one repo.
- **Single-repo runs** (`codeberg <dir>` without `--all`/`--repos`): behave
  exactly as before — no `repo` argument needed anywhere, and results carry
  the repo key too (harmless; the UI only shows it when more than one repo is
  in play).

Chunk ids are **only unique within a repo** (each repo's chunk table starts
its own id sequence), so `(repo, id)` — not the bare id — is a hit's identity.
This matters if you're consuming the HTTP API directly.

## Startup and indexing

`--all`/`--repos` index every selected repo **at daemon startup** (not lazily)
— a first cold index of several large repos back-to-back through one shared
embedder can take a while, so the wait scales with repo count on both sides:
the launcher's own health-check wait is 5 minutes per repo (minimum 15,
uncapped; override with `CODEBERG_HEALTH_TIMEOUT` as always), and the daemon's
internal wait for the indexer is the same 5-minutes-per-repo but capped at 60
minutes. A repo that already has a warm index (from a prior `codeberg <dir>`
run) starts in seconds regardless of how many other repos are in the set —
bootstrap only re-chunks/re-embeds what changed per repo, same as single-repo
mode.

Live per-repo progress is prefixed in the terminal/log
(`cberg-index[api]: embedded 340/512 chunks…`), and `codeberg --all`'s startup
line lists every repo key it's bringing up.

## Architecture (implementation notes)

- **Launcher** (`launcher/internal/registry`): owns the registry file and repo
  key derivation; `launcher/internal/config` resolves `--all`/`--repos`/
  `--no-index` into the final root set and encodes it as `CODEBERG_ROOTS`
  (`key\tpath` records) for the daemon.
- **C engine** (`core/cmd/cberg-index`): one process serves N roots. A single
  `cberg_engine` owns the shared ONNX embedder (every call serialized through
  one lock) and the IPC socket; each root gets its own `cberg_repo` — chunk
  table, Merkle manifest, filesystem watcher, and vector index, on the
  **unchanged** per-root on-disk layout (`<base>.<roothash>` +
  `.chunks`/`.manifest`). See [ADR 0004](../core/docs/adr/0004-multi-root-engine.md).
- **IPC protocol v2** (`daemon/docs/ipc.md`): `status` reports per-repo
  readiness; `search` takes an optional repo field; results carry a `repo` key.
- **Daemon** (`daemon/internal/{config,workspace,tools}`): `workspace.rootFor`
  resolves the `repo` argument tools already accepted (previously ignored); a
  new `repos` tool lists the served repositories; `/health` and `/search`
  surface the same per-repo/repo-scoped data over HTTP
  (`daemon/docs/http.md`).
- **Agent/web UI**: `search_code` gained an optional `repo` arg; the evidence
  ledger and CLI/web source rendering key on `(repo, id)` and show a `[repo]`
  prefix once more than one repo is in play.

## Limitations

- Embedding deduplication (identical function bodies reusing one vector) is
  per-repo, not cross-repo — the same snippet in two repos embeds twice.
- A crashed/restarted `cberg-index` process re-bootstraps every served repo
  (warm, so cheap); searches during that window return partial results from
  whichever repos are already ready again.
- `clean-index` still prunes *all* cached per-directory index sets at once
  (it can't single out one root); the next run against any given root simply
  rebuilds it.
