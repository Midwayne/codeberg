Describe the outcome you want. The agent chooses tools to search your selected project and gather evidence.

## Built-in tools

| Tools | Use |
| --- | --- |
| `search_code`, hybrid search | Find relevant source; semantic results require vectors. |
| `grep`, `glob` | Match exact text or paths. |
| `find_symbol`, chunk tools | Locate declarations and indexed source pieces. |
| `read_file`, `head`, `tail`, `sed` | Read current files or focused ranges. |
| `list_dir`, `tree` | Browse the source tree. |
| `git_log`, `git_blame` | Inspect Git history; requires Git. |
| Context and knowledge tools | Reuse evidence and [saved findings](/docs/knowledge). |

Built-in daemon source tools are read-only and scoped to configured roots. [MCP servers](/docs/mcps) can add operations, including writes to external services. [Skills](/docs/skills) add instructions rather than callable tools.

## Schedule a follow-up

In a browser chat with a configured model, ask the agent to return later:

```text
In 10 minutes, check this project again and summarize what changed.
```

For recurring work, specify the first run and interval, for example: “Starting in one hour, check for changes every hour.”

### View and cancel schedules

1. Open **Settings → Scheduled runs** from any chat. The view includes **all chats in the selected project**, including archived chats. No configured model is needed to inspect or cancel schedules.
2. Use **Active** for pending and running work, or **All** for completed, cancelled and failed schedules. Each entry shows its task, originating chat, timing and status. Expand **Task details** for the full prompt, IDs and saved model. Errors stay visible in **All**.
3. Click **Cancel schedule** to prevent a pending schedule from running. For an active occurrence, **Stop & cancel** also asks the current run to stop. Tool cleanup may take time; stopping cannot undo actions a tool already performed.

Each schedule also has **Open chat**, which opens its originating conversation and loads the latest saved results for an idle chat. Reloading an idle chat preserves its live message subscriptions and unsent draft; active, queued or unsaved local work stays intact. A deleted chat shows **Chat deleted** instead of an open action.

Background tools also appear here with their invocation status and a **Cancel tool** action. Cancelling requests a cooperative stop; the entry stays active until the call settles. If the call has already finished, a late cancellation preserves its final status and saved result or error. Cancelling a wake-up leaves its background tool running, and cancelling a background tool leaves its wake-up scheduled. Native MCP jobs use their own status/cancel tools.

Inside a chat, the **Scheduled runs** bar appears only when that chat has schedules or background tool entries, including history. Expand it above the conversation to inspect and cancel only that chat's jobs. The count shows pending and running work; **All** includes that chat's schedule history. A small clock beside a sidebar chat title indicates it has a pending schedule or an active occurrence. It disappears after that work completes or cancellation settles.

The view refreshes every five seconds while visible; **Refresh** checks immediately. Times use your browser's timezone. Switch projects to manage another project's schedules. You can cancel a retained schedule even after its chat was deleted.

The agent tools remain scoped to their own chat: ask “List this chat's scheduled runs” to inspect them, or “Cancel schedule <id>” to stop future occurrences. The agent's cancellation tool leaves an already active turn running; the user-facing **Stop & cancel** control stops it as well.

| Tool | Inputs and behavior |
| --- | --- |
| `schedule_run` | A follow-up `prompt` and exactly one trigger: `delay_seconds` greater than zero, `run_at` as a future ISO timestamp with `Z` or a timezone offset, or `after_tool_call_id` from the current turn. |
| `schedule_run` with `every_seconds` | Repeat a time-based schedule at a fixed interval of at least 60 seconds. Calendar/cron rules and daylight-saving adjustments are not supported. |
| `list_scheduled_runs` | Inspect schedules belonging to the current chat. |
| `cancel_scheduled_run` | Cancel by `id`. An already started turn continues; use **Stop** to stop it. |

Schedules stay in the same project and chat, retain the creating turn's model selection, and use the latest saved history. The agent writes responses and uses tools in that chat. Open chats automatically discover scheduled turns within the five-second refresh interval and stream their responses; no page reload is needed. Drafts stay intact, and updates wait while a chat has streaming, queued or unsaved local work. Normal provider and MCP costs apply to every occurrence. Each chat retains its latest 100 schedules. Completed history is removed as needed to admit more work; up to 100 active schedules are allowed.

Keep Codeberg running and the computer awake. Closing the browser is fine. Schedules survive server restarts, and projects with saved schedules are loaded without opening a browser. Overdue time-based schedules run once when available; missed recurring intervals are skipped. Active turns and resource cleanup delay dispatch. A failed, stopped or interrupted scheduled turn stops that schedule; inspect its error and create a new schedule after fixing the cause. Deleting the chat cancels pending work on the next dispatch check.

Tool calls already continue the active agent turn when their results arrive, even with the browser closed. `after_tool_call_id` adds a separate follow-up after that call has a recorded success or failure and the original turn has ended. It does not detach or suspend the original call, and it cannot monitor an external job unless a tool reports its completion. After a crash, a call without a recorded outcome is uncertain: its follow-up fails rather than repeating the call. These scheduling tools require server-owned browser chats; terminal one-shot questions do not run a scheduler.

## Let a long tool work while the agent sleeps

For a browser chat task that may take minutes or hours, the agent can start work, end its current turn and choose when to check again:

```text
Start this scan once. Check in two minutes; if it is still running,
choose when to check again. Keep checking until it completes, then summarize.
```

A scheduled turn can also call `sleep_agent` again to continue unfinished work. Each wake-up resumes in the original chat, can write a progress update or final answer, and can choose another wait without a new user message. Use a recurring schedule for fixed intervals; repeated sleeps let the agent adapt the delay to the task.

The chat marks each follow-up with **Resuming scheduled task…**. Its continuation prompt stays collapsed under **Task details**; the agent’s progress update or answer appears normally below it.

| Tool | What it does |
| --- | --- |
| `start_background_tool` | Calls an available tool with its original `tool` name and `args`; returns a Codeberg job ID immediately. |
| `background_tool_status` | Reads that job's status, latest yielded progress, result or error. Omit `job_id` to list this chat's jobs. |
| `sleep_agent` | Saves a continuation `prompt` with either `delay_seconds` or `run_at`, then ends the turn. Optional `job_ids` includes up to eight Codeberg job status snapshots at wake-up. |
| `cancel_background_tool` | Requests cancellation of a Codeberg invocation by `job_id`. |

The agent chooses each delay from the task and observed progress. A wake-up starts a new turn in the same chat, checks the existing job and may sleep again. There is no model request running during sleep; each wake-up incurs normal provider costs. A busy chat delays its wake-up. The scheduler uses an application timer, not OS cron.

Background invocations have independent cancellation signals and retain their MCP connection after the creating turn ends. They have no agent-turn deadline; the tool, transport or external service can still impose its own timeout. Approval-required tools and agent/schedule control tools cannot be detached. Normal action permissions apply. Limits are eight live invocations per chat and 32 per project, with a 32 MiB record limit and normal large-output spilling.

Keep Codeberg running and the computer awake for calls to keep working. Results and wake-ups are saved locally. After a Codeberg restart, unfinished invocations become **Interrupted**, with an uncertain outcome; Codeberg never repeats their start calls automatically. Inspect external state before retrying. A stopped or failed turn cancels the wake-up it just created through `sleep_agent`. Shutdown preserves saved wake-ups for recovery.

### MCPs with their own job handles

Prefer an MCP's native job API when available. A completed invocation can return a handle for work that is still running remotely. Save that native ID in the sleep prompt; Codeberg `job_ids` accepts only Codeberg invocation IDs.

For example, the Kafka MCP's `scan_messages` and `count_messages` can return a native `job_id` after their initial wait. The agent can start once with `wait_seconds: 0`, call `sleep_agent`, then use `get_job` after waking. If unfinished, it chooses another delay and sleeps again; if finished, it reads results, including additional pages when needed. Use Kafka's `cancel_job` to stop that native job. No change to the Kafka MCP is required.

Native job lifetime depends on the MCP server. This Kafka MCP stores jobs in memory with retention and scan time limits; restarting its process loses those jobs. Saving a wake-up does not make an external job durable.

## Follow the evidence

Ask for a concrete investigation:

```text
Trace this endpoint to the storage layer. Check callers and cite each step.
```

Expand tool output to inspect results. Hover or focus citations for full paths and line ranges; click to copy. Search can miss files or constructs, and the model can misinterpret results. Narrow broad answers with a filename, function, or error string.

While indexing runs, file tools remain usable. Hybrid search uses lexical matches and reference lookup can fall back to grep. Index-only tools report `NOT_READY`; this does not mean a symbol is absent. If a chunk-kind filter cannot be checked, search without that filter or use grep.

## Large tool results

Codeberg saves large results locally and gives the agent a preview and path.

| Tool | Limit per call |
| --- | --- |
| `context_read`, `context_tail` | 400 lines. |
| `context_grep` | 100 matches. |
| Any context file | 50 MiB; narrow the original request for larger output. |

Pages target 8,000 characters. Long lines use fragments up to 2,000 characters; `context_read` returns continuation positions for `start_line` and `start_column` (1-based UTF-16). Grep returns excerpts and positions. Regex searches and tails may still scan or buffer large lines.

## Optional decisions tool

Select **Models → Decisions API** to add `decide`. The agent can use it at any point to select candidate files, score relevance, check evidence, compare hypotheses, suggest test priorities, or choose a next step. It can use search snippets or pass candidate paths/ranges: Codeberg forwards bounded source excerpts directly to the selected provider and returns judgments and coverage metadata without putting source bodies into the main model's context. Omit custom questions with files to batch independent per-file relevance probabilities automatically. The tool cannot discover candidates, generate prose, or execute actions.

Decision calls have separate provider costs. They are optional and do not replace the chat model. See [Models and decisions setup](/docs/models#use-a-decisions-api) for providers, credentials, limits, and recovery.

## Optional web tools

**Web search defaults off.** Enable **Settings → Tools → Web search** for all projects. The saved preference survives restarts and applies to new chat turns.

| Setup | Requirements |
| --- | --- |
| Launcher-managed SearXNG | Git, Python 3 with venv/pip, network access; first setup can take several minutes. |
| Existing SearXNG | Set `CODEBERG_SEARXNG_URL`; the service must allow JSON responses. |
| Direct `codeberg-web` run | Supply an external SearXNG service. |

The panel shows setup status. On failure, toggle off/on to retry and inspect `logs/searxng.log` in Codeberg home.

Turning search off stops managed setup/service immediately but retains installed files. An active turn keeps its tool list and may see a search fail; new turns omit search. External servers are not stopped. Direct URL fetching stays available.

`CODEBERG_WEB_SEARCH_USE=true` sets the initial browser preference and terminal opt-in; a saved switch wins. A SearXNG URL alone does not enable search.

> **Master switch:** `CODEBERG_WEB_USE=false` disables search, URL fetching, and Browser Use. Change the launcher setting and restart to re-enable them. Source tools remain available.

## Browser Use delegation

Enable **Settings → Tools → Browser Use** to delegate a website task to a separate local browser agent. It defaults off and requires uv, Chrome/Chromium, and a model declared to support vision.

See [Browser Use](/docs/browser-use) for setup, screenshots, retained sessions, costs, and action boundaries.

## Optional canvas

Enable **Settings → Canvas** for a drawing canvas attached to each chat. Open copies of the same chat share scene updates.

Changes usually appear shortly after a file update. If filesystem notifications are unavailable, a fallback catches up within about 15 seconds. Closing the last connected canvas stops its watcher.

## Experimental search composition

Opt into `search_bundle` before launch:

```sh
CODEBERG_SEARCH_BUNDLE_USE=true codeberg
```

This read-only pipeline combines one to four explicit repository/query pairs, hybrid results, symbols, and up to eight indexed chunks. It preserves repository keys and line ranges; truncation and per-repository failures are explicit.

Output is capped at 10,000 serialized characters, including at most 6,000 characters of chunk bodies. Ordinary tools may be needed for omitted evidence. It cannot run scripts, edit source, or call MCP tools. It remains off by default while answer quality, token use, and latency are evaluated.
