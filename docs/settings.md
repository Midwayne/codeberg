# Web settings and resource management

Open **Settings** from the web header. The dedicated screen has two sections:
**Resource usage** and **Free up resources**. The existing **Model settings**
dialog has its own separate button in the main web header.

## Resource usage

Monitoring starts with the web server, even when the settings screen is closed:

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

The launcher supplies `CODEBERG_RESOURCE_ROOT_PID`, allowing the monitor to follow
its managed process tree: launcher, web server, learning, daemon, indexer, embedding
workers, MCP servers, and managed search. Browsers and the sampling `ps` process
are excluded. An older launcher's parent process is also recognized by its executable
name. For standalone web servers, the configured local daemon's `/health` PID
identifies its separate process tree; remote daemon PIDs are never used locally.

The **Measured processes** table lists included PIDs, CPU, and resident memory,
and states the actual measurement scope. On macOS/Linux, process counters come
from `ps`; if full process-tree sampling is unavailable, the dashboard explicitly
reports web-process-only metrics using Node's own counters.

CPU and memory are sampled every **10 seconds**. Filesystem and data-size metrics
are refreshed every **minute**. History is bounded to **360 samples / one hour**,
held in memory, and resets on web-server restart. The history charts offer
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
| `GET` | `/api/settings/resources` | `current`, `history`, `retentionMs`, `sampleIntervalMs` |
| `GET` | `/api/settings/cleanup?olderThanDays=30` | Category `count`/`bytes` preview |
| `POST` | `/api/settings/cleanup` | `deleted`, `failed`, `bytesFreed`, `categories`, `deletedChatIds` |

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
