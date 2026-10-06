# Web settings and resource management

Open **Settings** from the web header. The dedicated screen includes **Appearance**, **Projects**, **MCP servers**,
**Skills**, **Learning**, **Canvas**, **Resource usage**, and **Free up resources**. The existing **Model settings**
dialog has its own separate button in the main web header.
Settings opens on **Appearance**. On desktop, section navigation sits beside the
content; on smaller screens it becomes a compact grid. Usage and cleanup are
loaded only when their section is opened. Failed resource requests show a
**Try again** action; failed cleanup previews disable selection until totals
are available.

## Appearance

Choose **Dark**, **Light**, **Kanagawa** (Wave), **Tokyo Night** (Night),
**Catppuccin Mocha**, **Dracula**, **Nord**, or **Gruvbox**. Each option shows a
palette preview; the radio group supports Tab and arrow-key navigation.
The selection applies immediately across the UI and is saved in this browser's
local storage under `codeberg.theme`. It is restored before React renders on
reload. New browsers and invalid saved selections use the original **Dark**
theme. If local storage is unavailable, switching still works for the current page.

Named palettes adapt the upstream colors to Codeberg's shared semantic tokens:
[Kanagawa](https://github.com/rebelot/kanagawa.nvim/blob/master/lua/kanagawa/colors.lua),
[Tokyo Night](https://github.com/folke/tokyonight.nvim/tree/main/lua/tokyonight/colors),
[Catppuccin](https://github.com/catppuccin/catppuccin#-palette),
[Dracula](https://draculatheme.com/spec),
[Nord](https://www.nordtheme.com/docs/colors-and-palettes/), and
[Gruvbox](https://github.com/morhetz/gruvbox#palette).

## Learning

Learning settings apply to the selected project and save automatically. All
components default on, preserving existing behavior. **Enable learning** pauses
all collection, recall, and background jobs while retaining data and individual
choices. Re-enabling it resumes eligible queued work. A model request already
running may finish; changes to available chat tools apply on subsequent turns.

| Component | Controls | Token impact |
| --- | --- | --- |
| Codebase knowledge | Learn from solved answers; Use knowledge in chats; Automatic source refresh; Daily knowledge consolidation | Extraction and refresh call the learning model; recalled results add chat context |
| Learning history | Record chats and feedback; Use history in chats | Recording is local; recalled attempts add chat context |
| Dataset capture | Training review; Evaluations; individual example types | Local extraction and explicit review make no model calls |

Family switches pause all their subcomponents without clearing their selected
choices. For recall without background knowledge calls, leave **Codebase
knowledge** and **Use knowledge in chats** on, then turn off **Learn from solved
answers**, **Automatic source refresh**, and **Daily knowledge consolidation**. Similarly, historical recall can
stay on while **Record chats and feedback** is off. New knowledge and dataset
capture depend on recorded interactions; queued work from earlier recording can
continue independently. Feedback controls are hidden when recording is paused.
Previously retrieved content already in a conversation remains part of its history.

Expand **Knowledge categories** to select Services, Flows, Concepts, and
Debugging. Disabled categories are excluded from knowledge recall, refresh scans,
and generated artifacts. Expand **Example types** to independently capture Search
evidence, Solved answer, Better answer, Verifiable task, Incorrect result, and
Possible incorrect result. Turning off a type stops new candidate writes for it;
existing examples are kept. Training and evaluation switches control new reviewed
approvals. Evaluations are held-out data, not automatic model runs or retraining.

Knowledge consolidation reports are generated manually in this section, with
optional daily proposals off by default. Review before/after notes, apply a
report, or undo its view. Original extraction records remain intact; stale
proposals cannot be applied. See
[knowledge consolidation](continuous-learning.md#knowledge-consolidation-dreaming).

Settings are stored atomically in `learning/settings.json` under the project's
configured data directory. Invalid patches are rejected before writing. A failed
save restores the previous switches and offers an error with retry guidance.
If the launcher sets `CODEBERG_LEARNING_USE=false`, the panel explains how to
re-enable the service and restart; browser settings cannot override that switch.

## Canvas

Enable the optional **local canvas** for the selected project. New chat turns get
native canvas tools. Each chat’s drawing appears inline automatically when the
agent draws. **Expand canvas** opens the same scene full-window for editing. Drawings persist locally when the
feature is disabled. See [shared local canvas](canvas.md) for storage, tools,
revision conflicts and offline behavior.

## Resource usage

Monitoring starts in the Go daemon before indexer bootstrap, even when the
settings screen is closed. The agent transports cached snapshots:

- **Codeberg CPU:** the change in cumulative CPU time of this instance's measured
  processes between samples, as a percentage of the machine's total CPU capacity.
  The detail also shows the one-core percentage (100% means one fully busy core).
  For example, one fully busy core on a 16-core machine is 6.25% total capacity.
  The first interval is shown as collecting, rather than a fabricated zero.
- **Codeberg memory:** summed resident memory (RSS) of those processes, shown in
  bytes and as a percentage of physical RAM. Other applications and general OS
  cache usage are excluded. Shared resident pages may be counted in more than one
  process, so this is a resident-memory sum rather than unique physical ownership.
- **Codeberg disk:** allocated file blocks for Codeberg's local stored data,
  including `CODEBERG_HOME` (default `~/.codeberg`), configured sessions/learning/
  logs, and external `CBERG_MODEL` / `CBERG_INDEX_PATH` files and index sidecars.
  Symlinks are not traversed and hardlinks are counted once. Other files on the
  disk, repository source checkouts, and remote vector databases are not counted.

The launcher supplies `CODEBERG_RESOURCE_ROOT_PID` to both services, allowing the daemon to follow
its managed process tree: launcher, web server, learning, daemon, indexer, embedding
workers, MCP servers, and managed search. Browsers and the sampling `ps` process
are excluded. An older launcher's parent process is also recognized by its executable
name. Standalone web servers register their PID with the local collector, so
their processes and workers are included alongside the daemon and indexer.
Remote daemon PIDs are never used locally.

The **Measured processes** table lists included PIDs, CPU, and resident memory,
and states the actual measurement scope. Python workers are labeled by component,
for example **Embedding worker — Qwen3/MLX** and **Web search — SearXNG**.
Labels are cached per process identity. Only fixed component/model-family names
are displayed; raw command arguments remain local to the collector.
Linux uses native `/proc` CPU counters
and resident pages; macOS uses one bounded `ps` call per interval. An unavailable
or older daemon uses a dedicated Node worker thread. Its synchronous filesystem
calls run on that private thread, outside both the chat event loop and its libuv
filesystem pool. Unsupported process-tree sampling is explicitly labeled web-only.

CPU and memory are sampled every **10 seconds** on an independent background loop.
Disk usage is refreshed every **five minutes**, after bootstrap, and after cleanup.
Disk scans are single-flight, cancellation-aware, and have a 30-second time budget;
cleanup notifications are coalesced with a short delay. Requests never initiate
or wait for a scan. A slow disk scan does not delay daemon CPU sampling or search.
History is bounded to **360 samples / one hour**, held by the collector, and resets
when that collector restarts. A web-server restart preserves daemon history.
Historical points contain aggregate usage; only `current` includes the PID table.
The browser fetches full history once, then requests only newer points using
`after=<timestamp>`. Polling pauses in hidden tabs, and chart geometry is reused
while inspecting hover values. The history charts offer
5-minute, 15-minute, and 1-hour views with auto-scaled axes. Hover or tap to show a
crosshair, the exact recorded value, and its timestamp. Focus a chart and use
arrow keys (or Home/End) to inspect samples from the keyboard. No additional
package dependencies or C-core instrumentation are required.

## Free up resources

Each category can be selected independently or combined with the others:

| Category | Files removed | Age used |
| --- | --- | --- |
| Saved chats | Browser sessions, including archived conversations; pinned chats are kept | Session `updatedAt` |
| Training data | Candidate, training, evaluation, and dismissed JSON examples | Newest extraction/review date across copies of the same example |
| Knowledge documents | Generated Markdown in services, flows, concepts, and debugging | Artifact `updated_at` |

Choose **7, 30, 90, or 365 days**, or **All ages**. Counts and reclaimable sizes
are previewed before deletion. **Delete selected data…** opens an explicit
confirmation. Only valid records with a known age are eligible; malformed files
and symlinks are skipped. Recently reviewed examples retain their candidate
copies too, so review state remains consistent.

Cleanup re-evaluates eligibility at execution time, so the final count can differ
from the preview. Chat age and pins are checked under the same per-session
serialization used for saves. Training cleanup shares the dataset promotion
lock. Derived-data cleanup pauses local learning scheduling, rejects queued or
active work, and updates knowledge source watches afterward. HTTP writes and
streaming chat responses block cleanup, and cleanup blocks new writes until it
finishes. Close other CLI processes sharing this data directory before cleanup.

Interaction/feedback events and durable job receipts are retained. Training and
knowledge use those events for provenance/freshness checks, and keeping completed
receipts prevents unchanged data from being regenerated solely by a restart.
New feedback, code changes, or a future extraction-policy update may generate
new artifacts. Repository source files, models, indexes, credentials, and
configuration are outside the cleanup categories.

When saved chats are removed, the current browser refreshes its sidebar and
disposes the corresponding cached conversations, starting a new chat if needed.

## HTTP API

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/api/learning/settings` | Current project learning choices |
| `PUT` | `/api/learning/settings` | Saved choices after a partial boolean patch |
| `GET` | `/api/settings/resources[?after=<timestamp>]` | Cached `current`, incremental `history`, retention/intervals, collector identity |
| `GET` | `/api/settings/cleanup?olderThanDays=30` | Category `count`/`bytes` preview |
| `POST` | `/api/settings/cleanup` | `deleted`, `failed`, `bytesFreed`, `categories`, `deletedChatIds` |

Learning PUT accepts a partial JSON object, including partial category/type maps:

```json
{ "knowledgeCapture": false, "knowledgeRefresh": false, "evals": false,
  "categories": { "debugging": false }, "kinds": { "preferences": false } }
```

Unknown keys and non-boolean values return 400. PUT requires `application/json`,
rejects a mismatched browser Origin, and serializes writes. Settings remain
accessible when the overall browser learning toggle is off. Disabled feedback or
review components reject new writes with 409 while historical records remain
readable. The launcher-level disable makes all learning routes unavailable.

Cleanup POST accepts JSON:

```json
{ "categories": ["chats", "training", "knowledge"], "olderThanDays": 30 }
```

`olderThanDays` must be an integer from 0 to 36500; **0 means all ages**. Category
selections must be nonempty, unique, and drawn from the three names above. Invalid
input returns 400, concurrent writes/learning return 409, and incorrect methods
return 405. POST requires `application/json` and rejects a mismatched browser
Origin. Per-file deletion failures are counted in `failed` and logged; successful
deletions still update the browser cache. Responses are not cached.

### Daemon transport

The loopback-only daemon endpoints are `GET /resources?after=<timestamp>`,
`POST /resources/clients` with `{ "pid": <web PID> }`, and
`POST /resources/refresh`. Registration and refresh only enqueue background work.
The agent relays JSON bytes without parsing/re-encoding the historical payload.

### Performance verification

A focused macOS harness used 20,001 files (80 directories of 250 one-byte files,
plus a probe file), concurrent HTTP file-read probes every 5 ms, a fixed two-second
measurement window, and three trials. Baseline: `b59493e`.

| Median measurement | Agent collector baseline | Daemon collector |
| --- | ---: | ---: |
| Agent CPU time in the two-second window | 1,120.7 ms | 316.9 ms |
| Disk sweep wall time | 1,106.7 ms | 597.0 ms |
| Cold metrics read | waited for the 1,106.7 ms sweep | 0.21 ms cached reply |

This is approximately **72% less agent CPU** in the harness. A cold cached reply
may initially be empty; collection continues independently and the UI briefly
polls for initial data. The harness's ordinary HTTP latency was already low, so
these numbers demonstrate removal of collection CPU and cold-read waiting rather
than a claim about LLM response speed.
