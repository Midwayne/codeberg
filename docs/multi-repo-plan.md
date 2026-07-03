# Multi-Repo Architecture for codeberg

## Context

codeberg currently indexes and searches exactly one directory: `CODEBERG_ROOT` flows launcher → daemon → one C `cberg-index` process holding one chunk table / watcher / HNSW index. The goal is a multi-directory architecture: `codeberg <dir>` keeps single-repo behavior (and registers the dir), while `codeberg --all [--web]` searches all previously-indexed repos combined. Indexing stays on-demand — a repo is only indexed when you run against it; `--all` warm-starts every registered repo at daemon boot.

**Decisions made with the user:**
- **Auto-registry**: every root ever run is remembered in `~/.codeberg/repos`; `--all` = all registered roots.
- **Index all registered repos at daemon startup** in `--all` mode (not lazy).
- **One multi-root C process**: extend `cberg-index` to manage N roots sharing ONE ONNX embedder (avoids N× model RAM). This reworks the C singleton.

All work happens in the `codeberg` repo (canonical upstream), not `codeberg-internal`.

**Groundwork already in place:** per-root index files (`<CBERG_INDEX_PATH>.<roothash16hex>` + `.chunks`/`.manifest`, derived in `core/cmd/cberg-index/indexer.c:716-731`) stay unchanged, so warm start and `cleanindex` (tagLen=17) keep working. Workspace tools already accept a `repo` param (`daemon/internal/workspace/workspace.go:84` ignores it today) and tool JSON schemas already document it. ADR 0003 (per-repo Merkle manifests) anticipated this.

## Identity & wire conventions (used throughout)

- **Repo key**: basename of the realpath'd root; on collision append `-<first 6 hex of roothash>` (same hash as `root_suffix()` in indexer.c). Launcher registry is the single source of truth for key→path.
- **Registry file** `~/.codeberg/repos`: one `<key>\t<abs-path>` per line, `#` comments, atomic temp+rename writes.
- **`CODEBERG_ROOTS` env**: newline-separated `<key>\t<path>` records (same shape as registry lines). When set it wins; `CODEBERG_ROOT` stays as single-root fallback (backward compat).
- **Chunk ids collide across repos** (each table starts at 1) — `(repo, id)` is the identity downstream.

## Step 1 — Launcher registry (lands alone, no behavior change)

New package `launcher/internal/registry/registry.go`:
- `Entry{Key, Root string}`; `Load(home)`, `Upsert(home, root)` (realpath, dedup by resolved path, basename key with hash-suffix disambiguation, atomic rewrite).
- Hook `cmdRun` (`launcher/cmd/codeberg/main.go:114`): after config validates, `registry.Upsert(...)`; failure = warning, never fatal.
- **Positional dir support**: `dispatch()` (main.go:42-70) currently treats the first non-flag arg as a subcommand — `codeberg <dir>` fails today. If `args[0]` isn't a known subcommand but stats as a directory, rewrite to `cmdRun(append([]string{"--root", args[0]}, args[1:]...))`.
- Add `codeberg repos` subcommand: list key, path, exists-on-disk.

Tests: `registry_test.go` — upsert idempotency, collision disambiguation, atomic rewrite.

## Step 2 — C engine refactor: N-root capable, single-root byte-identical

The risky core step. Files: `core/cmd/cberg-index/{indexer.h,indexer.c,main.c,ipc.c,ipc.h}`, cmd `CMakeLists.txt`.

**2a. Split the singleton** (`cberg_indexer`, indexer.h:10-30) into:
- `cberg_engine`: model_path, index_base, socket_path, poll_ms, vectors, **one `cberg_embedder*` + `pthread_mutex_t embed_mu`**, `cberg_repo **repos`, stop flag.
- `cberg_repo`: back-pointer to engine, key, root, derived index/chunks/manifest paths (move path derivation from indexer.c:716-731 verbatim), chunker, table, manifest, watcher, HNSW index, per-repo `mu`, ready flag.
- Lifecycle: `cberg_engine_open` (env parse + embedder once) → `cberg_repo_open` per root → `cberg_repo_bootstrap` per repo **sequentially** (embedder is the bottleneck anyway; check `eng->stop` between repos) → `cberg_engine_run` → `cberg_engine_close`.
- Env: `CODEBERG_ROOTS` parsed as key\tpath records, realpath each, dead path = warn + skip (must not kill daemon). Fallback `CODEBERG_ROOT` → one repo, key = basename.
- **Embedder serialization**: single wrapper `engine_embed()` holding `embed_mu`; the raw `cberg_embedder_embed` call appears exactly once in the cmd. Convert call sites: `embed_unique` (~indexer.c:274), `rebuild_index` (~:468), query embed. Lock order strictly `repo->mu → embed_mu`; search embeds under `embed_mu` alone, then takes one `repo->mu` at a time. Keep `embed_mu` inside embed_unique's batch loop, not around it (search queries wait ≤ one batch).
- Prefix all log lines with `cberg-index[<key>]:` — gives the launcher per-repo progress for free through the existing startup tee.

**2b. Multiplexed run loop**: replace the blocking `cberg_watcher_poll(..., poll_ms)` (indexer.c:~1084) with a round-robin: non-blocking poll each repo's watcher, apply changes under that repo's `mu`, sleep `poll_ms` (stop-aware) only when no repo had events. Works on macOS (FSEvents fills dirty set async) and Linux (timeout-0 inotify drain); the mtime-polling fallback scans N trees per tick — acceptable, note it.

**2c. Search without double-embedding**: add to core lib `cberg_search_vector(index, query_vec, config, k, ...)` (in `core/src/search/search.c` + `codeberg.h`); refactor `cberg_search_query` to embed-then-call. Engine search `cberg_engine_search_hits(eng, query, repo_key /*NULL=all*/, k, ...)`: embed once, per target repo lock `mu`, skip if not ready, search HNSW, resolve via `cberg_chunk_table_find_by_id`, fill snippet, tag with repo key; merge by score desc, truncate to k. Unknown repo key → `CBERG_ERR_NOT_FOUND`.

**2d.** `ipc.c` switches handle to `eng` but keeps the wire protocol identical in this step (`status` = all-ready / summed chunks).

Tests: existing `core/test/*` stay green; add `cberg_search_vector` cases to `test_search.c`. New `core/cmd/cberg-index/test_engine.c` (registered like `test_cberg_walk`): chunk-only mode, two temp roots via `CODEBERG_ROOTS` — both bootstrap, independent tables, a write in root A only changes A after a poll cycle, `CODEBERG_ROOT` fallback works. Manual regression gate: single-repo run produces identical on-disk files, warm-start log, and search results.

## Step 3 — IPC protocol v2

`core/cmd/cberg-index/ipc.c`:
- `status` gains `"repos":[{"key","ready","chunks"},...]` (old Go client ignores unknown fields).
- `search` accepts optional 4th field `search\t<q>\t<k>\t<repo>`; rewrite parsing to scan tabs left-to-right (the current `strrchr(query,'\t')` trick at ipc.c:81 breaks with a 4th field; Go client already strips tabs from queries).
- Each result gains `"repo":"<key>"`. Bump per-hit headroom in the 32KB response buffer (256→512).

Test: socket round-trip in `test_engine.c` (send `status`, `search\tfoo\t5\trepoA`, assert JSON shape).

## Step 4 — Daemon: multi-root config, fan-out, workspace, gitpull

Files under `daemon/`:
1. **config** (`internal/config/config.go`): `EnvRoots`, `RepoRoot{Key, Path}`, `Roots []RepoRoot`, `DefaultKey string`. `CODEBERG_ROOTS` set → parse/resolve, skip+log dead paths, `DefaultKey=""`; else single-root → `Roots=[{basename, root}]`, `DefaultKey=basename`.
2. **supervisor** (`internal/supervisor/supervisor.go:49-59`): forward `CODEBERG_ROOTS` to the C process; keep `CODEBERG_ROOT` for single-root.
3. **indexctl** (`internal/indexctl/client.go`): `SearchResult.Repo string`; `Status.Repos []RepoStatus`; `Search(ctx, query, k, repo)` appends `\t<repo>` only when non-empty.
4. **httpserver** (`internal/httpserver/server.go`): `/search` gains optional `repo` query param; `/health` includes per-repo readiness.
5. **workspace** (`internal/workspace/workspace.go`): `New(repos []config.RepoRoot, defaultKey string)`; `rootFor(repo)` (lines 84-86) resolves the map — empty repo → default root, or in `--all` mode an error listing available keys. Add `Repos()` accessor.
6. **tools** (`internal/tools/`): new no-arg `repos` tool returning `ws.Repos()`, registered in `default.go`; update `repo` param descriptions in `filetools.go`/git tool schemas.
7. **gitpull** (`internal/gitpull/gitpull.go`): take `dirs []string`, skip dirs without `.git`.
8. **main.go** (`cmd/codeberg-d/main.go`): `workspace.New(cfg.Roots, cfg.DefaultKey)`; scale `startupTimeout` (line 21, currently 5m) by repo count (cap ~60m); pass all roots to gitpull.

Tests: config parseRoots, workspace multi-root + escape checks per root, httpserver repo param, indexctl fake-socket with repo-tagged JSON, repos tool.

## Step 5 — Launcher: `--all` flag, roots plumbing, health UX

Files: `launcher/cmd/codeberg/main.go`, `launcher/internal/config/config.go`, `launcher/internal/run/run.go`:
1. `--all` bool flag in `parseShared` (near `--web`, main.go:91), `KeyAll="CODEBERG_ALL"` env + config key, `Config.All bool`. Explicit `--root` + `--all` → error; config-file root is simply ignored under `--all`.
2. `Config.Roots []registry.Entry`: `--all` → `registry.Load` filtered by `os.Stat` (warn+skip dead; zero live entries → error "no repos registered yet — run codeberg <dir> first"); otherwise the single upserted entry. `ValidateForRun` skips the root requirement when `All`.
3. `DaemonEnv()` (config.go:338-353): always emit `CODEBERG_ROOTS` encoded from `c.Roots`; keep `CODEBERG_ROOT` in single-root mode, omit in `--all`.
4. `run.Run`: startup message "indexing N repo(s): k1, k2…"; `healthDeadline()` default scales `max(15m, 5m × len(Roots))`, `CODEBERG_HEALTH_TIMEOUT` still wins. Per-repo progress comes free from the `cberg-index[key]:` stderr prefixes.
5. `--all --web` composes with no extra work (web path orthogonal, run.go:186-199). Update `usage()`.

## Step 6 — Agent/UX: repo-tagged results

Files: `agent/src/core/types.ts`, `agent/src/core/tools/search-code.ts`, `agent/src/core/evidence.ts`, `agent/src/core/format.ts` (+ web sources renderer if it formats independently):
1. `SearchResult` gains `repo?: string`.
2. `search-code.ts` tool chunk includes `repo` so the model can pass it to `read_file`/`grep`.
3. **Correctness fix** `evidence.ts:21-22`: dedupe key becomes `` `${repo ?? ""}#${id}` `` — bare-id dedupe drops legitimate cross-repo hits.
4. `format.ts`: show `[repo]` prefix in source lines whenever present.
5. Daemon-proxied tools pass through generically — new `repos` tool appears with no agent changes.

Tests: `evidence.test.ts` (cross-repo same-id not deduped), `search-code.test.ts`.

## Step 7 — Docs

New ADR `core/docs/adr/0004-multi-root-engine.md` (one process / one embedder / per-root state, sequential bootstrap, registry owned by launcher, protocol v2; note parallel chunk-parse with serialized embed as a future optimization). Update `daemon/docs/ipc.md`, `daemon/docs/http.md`, `CHANGELOG.md`.

## Risk register

1. **Shared embedder threading** — ONNX embedder not thread-safe; enforce single `engine_embed` choke point, lock order `repo->mu → embed_mu` never reversed.
2. **Watch-loop multiplexing** — non-blocking polls + sleep adds ≤ poll_ms latency; mtime-fallback platform scans N trees/tick.
3. **Two startup timeouts** (daemon 5m at `codeberg-d/main.go:21`, launcher 15m default) must both scale with repo count or first cold `--all` fails spuriously.
4. **Cross-repo id collisions** — fixed in the evidence ledger; audit any other bare-id keyed logic.
5. **Single-repo regression** — gate: identical on-disk artifacts/logs/results for a plain `codeberg <dir>` run; `cleanindex` needs zero changes.
6. **Supervisor restart in `--all`** — crash re-bootstraps all repos (warm) while HTTP stays up; searches skip not-ready repos and return partial results (intentional, document it).

## Verification (end-to-end)

1. `make` / existing test suites green in core, daemon, launcher, agent.
2. Regression: `codeberg <dir>` on one repo → identical index files (`<base>.<hash>`, `.chunks`, `.manifest`), warm start works, search results unchanged, no `repo` noise in single-repo UX.
3. Multi: `codeberg <dirA>` then `codeberg <dirB>` (registers both) → `codeberg --all`: both warm-start with per-repo progress lines; `/health` shows both ready; a search returns hits tagged from both repos; `grep`/`read_file` tools with explicit `repo` key work; `repos` tool lists both.
4. `codeberg --all --web`: web UI shows `[repo]`-prefixed sources.
5. Edge cases: `--all` with empty registry → helpful error; registry entry with deleted path → warn + skip, daemon still healthy; `--all --root x` → usage error.
