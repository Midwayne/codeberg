Describe the outcome you want. The agent chooses tools to search your selected project and gather evidence.

## Built-in tools

| Tools | Use |
| --- | --- |
| `search_code`, `hybrid_search` | Find relevant source; these tools are registered when embeddings are enabled. |
| `grep`, `glob` | Match exact text or paths. |
| `find_symbol`, chunk tools | Locate declarations and indexed source pieces. |
| `search_graph`, `trace_path`, `find_references` | Inspect structural relationships and symbol usage; available without embeddings after parsing. |
| `read_file`, `head`, `tail`, `sed` | Read current files or focused ranges. |
| `list_dir`, `tree` | Browse the source tree. |
| `git_log`, `git_blame` | Inspect Git history; requires Git. |
| Context and knowledge tools | Reuse evidence and [saved findings](/docs/knowledge). |
| `context_status`, `context_keep`, `context_release` | Check context usage and choose which tool results to keep or drop; see [Let the agent manage its context](/docs/models#let-the-agent-manage-its-context). |
| `worklist_add`, `worklist_read`, `worklist_retire` | Keep this chat's [working list](#keep-a-working-list) of findings and constraints. |

Built-in daemon source tools are read-only and scoped to configured roots. [MCP servers](/docs/mcps) can add operations, including writes to external services. [Skills](/docs/skills) add instructions rather than callable tools.

## Choose a graph tool

The source-code graph describes parsed relationships between files and symbols. It works without embeddings after parsing. Start with the question you want to answer:

| Question | Tool | What to expect |
| --- | --- | --- |
| Where should I start in this codebase? | `get_architecture` | Indexed size, language mix, highly connected call symbols, and candidate entrypoints. |
| Which definition of `Save` is this? | `search_graph` | Exact, case-sensitive name lookup with repo, kind, path, and line range. Use `grep` to discover unknown names. |
| Who calls it, or what does it call? | `trace_path` | Follow calls with `direction: "in"` for callers or `"out"` for callees. Set `max_depth: 1` for direct relationships. Defaults follow both directions for two steps. |
| Where else is this symbol used? | `find_references` | Graph relationships plus additional text matches, including possible unresolved uses. |
| What might a change affect? | `detect_changes` | Changed symbols in the selected/default Git repository and nearby callers/callees across configured roots. Direct/transitive labels indicate graph proximity, rather than confirmed breakage. |

For example, ask:

```text
Find Save in storage/src/store.ts and show its direct callers.
Check the source lines before explaining what each caller does.
```

The agent can locate the definition with `search_graph`, then pass its `repo` and relative file path as `trace_path`'s `path_prefix`. These filters select the starting definition; they do not restrict later hops. Import-backed relationships can cross into other roots configured in the same workspace. Keep the repo key with each returned ID and path. Use a file node with `edge_kind: "imports"` for file dependencies, or a type with `"contains"` for its members.

Graph confidence is a heuristic, not a measured probability. Same-name methods may remain ambiguous, and aliases or dynamic relationships may be missing. Verify the returned source and continue with text/file tools when needed; an empty graph result does not prove absence. HTTP/RPC relationships need source tracing through clients, routes, and configuration. See [Language and cross-repo limits](/docs/indexing#follow-dependencies-across-repositories).

## Inspect symbol usage

Use `find_references` to combine graph usages with word-boundary text matches. The response keeps graph edges in `graph` and additional lexical evidence in `matches`; the UI displays both. A graph hit no longer prevents the tool from checking file contents. Lexical matches at a graph hit's file and line are deduplicated.

| Option or result | Meaning |
| --- | --- |
| `symbol` | Exact symbol spelling; lexical search uses word boundaries. |
| `repo` | Select the graph target's repository; incoming graph callers may belong to other configured roots. Lexical matches use this repo when supplied, or all configured roots when omitted. |
| `path_prefix` | Restrict graph target lookup by path prefix. |
| `path_glob` | Restrict lexical matches to matching files. |
| `limit` | Shared budget for graph edges and additional lexical matches: default 50, maximum 200. Graph edges have priority. |
| `source` | `graph`, `grep`, or `graph+grep`, according to returned evidence. |
| `partial` | Always true: the result does not prove that every usage has been found. |
| `limit_reached` | A source reached its retrieval limit or the combined budget excluded evidence. Narrow the scope and repeat. |
| `graph_error`, `lexical_error` | An unavailable source; usable evidence from the other source is retained. |

Graph edges carry `src_repo` and `dst_repo`; lexical matches carry `repo`. Deduplication uses the source repo, path, and line, so identical paths in different roots remain distinct. IPC clipping also sets `limit_reached` and reports a graph coverage error while preserving usable edges, including when lexical search also fails.

Text matches may include declarations and comments, and graph confidence is heuristic. An empty result does not prove that a symbol is unused. Callers and non-call references have different edge kinds; inspect the evidence before changing a public interface. See [Graph coverage and limits](/docs/indexing#follow-callers-and-references) and [Cross-repo dependencies](/docs/indexing#follow-dependencies-across-repositories).

## Schedule a follow-up

In a browser chat with a configured model, ask the agent to return later:

```text
In 10 minutes, check this project again and summarize what changed.
```

For recurring work, specify the first run and interval, for example: “Starting in one hour, check for changes every hour.”

The agent knows today's date and the server's time zone, so clock times such as “tomorrow at 9” work. It sets up the schedule without asking for confirmation and tells you when it will run. If you ask for a recurring check without an interval, it picks one and says which.

### View and cancel schedules

1. Open **Settings → Scheduled runs** from any chat. The view includes **all chats in the selected project**, including archived chats. No configured model is needed to inspect or cancel schedules.
2. Use **Active** for pending and running work, or **All** for completed, cancelled and failed schedules. Each entry shows its task, originating chat, timing and status. Expand **Task details** for the full prompt, IDs and saved model. Errors stay visible in **All**.
3. Click **Cancel schedule** to prevent a pending schedule from running. For an active occurrence, **Stop & cancel** also asks the current run to stop. Tool cleanup may take time; stopping cannot undo actions a tool already performed.

Each schedule also has **Open chat**, which opens its originating conversation and loads the latest saved results for an idle chat. Reloading an idle chat preserves its live message subscriptions and unsent draft; active, queued or unsaved local work stays intact. A deleted chat shows **Chat deleted** instead of an open action.

Background tools also appear here with their invocation status and a **Cancel tool** action. Cancelling requests a cooperative stop; the entry stays active until the call settles. If the call has already finished, a late cancellation preserves its final status and saved result or error. Cancelling a wake-up leaves its background tool running, and cancelling a background tool leaves its wake-up scheduled. Native MCP jobs use their own status/cancel tools.

Inside a chat, a **Scheduled** button appears in the header only when that chat has schedules or background tool entries, including history. Select it to open a dialog where you can inspect and cancel only that chat's jobs. The count and green dot show pending and running work; **All** includes that chat's schedule history. A small clock beside a sidebar chat title indicates it has a pending schedule or an active occurrence. It disappears after that work completes or cancellation settles.

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

While the agent sleeps, the chat shows a **Sleeping · wakes in 10m** divider that counts down. Select it to read the continuation prompt and the exact wake-up time. It changes to **Waking up…** and then **Woke up** on its own, or **Wake-up cancelled** if you cancel it from **Scheduled**.

The chat marks each follow-up with a **Resuming scheduled task… · Task details** divider. Select it to show the continuation prompt; the agent’s progress update or answer appears normally below it.

| Tool | What it does |
| --- | --- |
| `start_background_tool` | Calls an available tool with its original `tool` name and `args`; returns a Codeberg job ID immediately. |
| `background_tool_status` | Reads that job's status, latest yielded progress, result or error. Omit `job_id` to list this chat's jobs. |
| `sleep_agent` | Saves a continuation `prompt` with either `delay_seconds` or `run_at`, then ends the turn. Optional `job_ids` lists up to eight Codeberg jobs: the agent wakes as soon as all of them finish, or at its chosen time if that comes first, and gets their status snapshots. |
| `cancel_background_tool` | Requests cancellation of a Codeberg invocation by `job_id`. |

The agent chooses each delay from the task and observed progress. A wake-up starts a new turn in the same chat, checks the existing job and may sleep again. There is no model request running during sleep; each wake-up incurs normal provider costs. A busy chat delays its wake-up. The scheduler uses an application timer, not OS cron.

Background invocations have independent cancellation signals and retain their MCP connection after the creating turn ends. They have no agent-turn deadline; the tool, transport or external service can still impose its own timeout. Approval-required tools and agent/schedule control tools cannot be detached. Normal action permissions apply. Limits are eight live invocations per chat and 32 per project, with a 32 MiB record limit and normal large-output spilling. Subagent reports are kept whole, as in the chat.

Keep Codeberg running and the computer awake for calls to keep working. Results and wake-ups are saved locally. After a Codeberg restart, unfinished invocations become **Interrupted**, with an uncertain outcome; Codeberg never repeats their start calls automatically. Inspect external state before retrying. A stopped or failed turn cancels the wake-up it just created through `sleep_agent`. Shutdown preserves saved wake-ups for recovery.

### MCPs with their own job handles

Prefer an MCP's native job API when available. A completed invocation can return a handle for work that is still running remotely. Save that native ID in the sleep prompt; Codeberg `job_ids` accepts only Codeberg invocation IDs.

For example, the Kafka MCP's `scan_messages` and `count_messages` can return a native `job_id` after their initial wait. The agent can start once with `wait_seconds: 0`, call `sleep_agent`, then use `get_job` after waking. If unfinished, it chooses another delay and sleeps again; if finished, it reads results, including additional pages when needed. Use Kafka's `cancel_job` to stop that native job. No change to the Kafka MCP is required.

Native job lifetime depends on the MCP server. This Kafka MCP stores jobs in memory with retention and scan time limits; restarting its process loses those jobs. Saving a wake-up does not make an external job durable.

## Keep a working list

In a long chat, older messages are summarized to fit the model's context, and a summary can drop detail. The agent keeps a working list for the facts it must not lose: confirmed findings with their citations, constraints you gave, decisions, and plan steps. Entries are kept in full, whatever happens to the transcript.

The agent records and reads the list on its own. It re-reads the list after history is summarized, when a scheduled or woken turn starts, and before answering a long task. You can also ask for it:

```text
Add to your working list that releases must not change codeberg.h.
Show your working list.
What does your working list say about the daemon port?
```

| Tool | What it does |
| --- | --- |
| `worklist_add` | Records up to 20 entries per call, each under 2,000 characters, with optional `tags`. Text already on the list is not added again. |
| `worklist_read` | Lists entries in the order they were recorded. `pattern` searches text and tags, case-insensitively; `regex: true` treats it as a regular expression; `tag` keeps one tag. |
| `worklist_retire` | Marks an entry wrong or outdated, with an optional `reason` and a `correction` saved as a new entry. Retired entries stay readable with `include_retired`. |

| Scope | Behavior |
| --- | --- |
| Browser chat | One list per chat, shared by the chat's subagents; each entry notes which subagent added it. Saved on disk and kept across restarts. Deleting the chat deletes its list. |
| Branched chat | Starts with an empty list. |
| Terminal question | Kept in memory until the process exits. |
| Size | Up to 500 entries per chat, retired entries included. |

The list is the agent's notes, not evidence: it re-reads the code before citing a finding that may have changed. To keep something across chats, use [Knowledge](/docs/knowledge) instead. The tools make no model calls; entries the agent reads back add to the chat's context.

## Split work across subagents

When a request needs several independent checks, the agent hands each one to a subagent with `run_subagents`, without being asked. Subagents run at the same time on a smaller model, and each returns a short report, so the chat model reads conclusions instead of every log line or metric.

```text
Check the health, error-rate metrics, and last hour of logs for checkout,
billing, and search in staging. Summarize anything unusual.
```

Reports go to the agent, which checks surprising claims and writes the answer.

### Watch subagents work

Each `run_subagents` call shows as a card in the chat, outside the folded tool-call list. Every subagent has a row with its short description, type, and status: **Queued**, **Running**, **Done**, **Stopped at its step limit**, or **Failed**. A running row shows its current step, tool calls, elapsed time, and the tool it is calling now. Select a row to read its report, the brief it was given, its token use, and the path to its full transcript. Follow-ups sent with `message_subagent` show as their own card. A follow-up the agent sends to a subagent that no longer exists folds into the tool-call list; the agent starts a new one instead.

| Behavior | Details |
| --- | --- |
| Model | The model chosen under **Models → Subagents**. **Same as summary model** (the default) uses the **Summaries** model, then the chat model. Requests appear in Usage under that model. |
| Types | `explorer` (default) only investigates and is told not to change anything. `worker` may also change things when the brief asks. Both can call every MCP tool; see **Tools** below. |
| Limits | The agent decides how many subagents to start, up to 64 per call and 64 running at once in each chat. Subagents and chat turns have no time or step limit: they work until they answer or you press **Stop**. A model request fails only if the provider stays silent (10 minutes to start, 5 minutes between streamed output) and is retried first. An ordinary tool call that runs over 10 minutes is stopped and reported to the agent. See [timeouts and budgets](/docs/environment#context-and-tool-calling). Older tool output in a long subagent run is summarized as its context fills. |
| Tools | Both types can call every MCP tool from every connected server. They see the same server and tool list as the agent and load the MCP tools they need themselves. Explorers otherwise only read: code, files, Git, context, web pages, background job and schedule status, and the canvas, and are told not to change anything. Workers can also run scripts, start and cancel background tools, create time-based schedules, edit the canvas, and use Browser Use. Background tools and schedules a subagent starts belong to the chat. |
| Not available | Sleeping, saving or forgetting memories, starting more subagents, and tools that need approval. |
| Context | A subagent sees only its brief, not the chat. The agent writes each brief to stand on its own: the goal and what done looks like, what is already known, numbered steps when the method is known, and what to report. |
| Follow-ups | Each report has an `agent_id`. The agent can ask that subagent a follow-up with `message_subagent`; it continues from its own history. A subagent no longer in memory, after a restart, a model change, or when a chat has used more than 64, is restored from its saved transcript. One chat cannot message another chat's subagents. |
| Step budget | Optional. With `CODEBERG_SUBAGENT_MAX_STEPS` set, a subagent that reaches it writes a final report from what it found, marked `incomplete`. |
| Failures | A failed subagent is reported with its error; the others still return. **Stop** cancels all of them. |
| Transcripts | Saved as `subagents/<agent_id>.json` in the project's context directory; the agent can open them with context tools. |

Quick lookups and steps that depend on an earlier result stay with the chat model. To keep work in one agent, say so in your message, or turn subagents off. Each subagent makes its own model requests, so eight tasks cost roughly eight small investigations, and many at once can reach your provider's rate limits; a rate-limited subagent is reported as failed.

### Sleep while subagents work

For a long sweep, the agent can start `run_subagents` as a [background tool](#let-a-long-tool-work-while-the-agent-sleeps), then call `sleep_agent` with its job ID. The turn ends, and the agent wakes as soon as the subagents finish, or at the time it chose if that comes first.

The subagent card stays in the chat with an **In background** tag and keeps updating while the agent sleeps, about every two seconds. Once the subagents finish, it shows their reports. If you cancel the job or it fails, reports from subagents that already finished stay. When the agent reads the job with `background_tool_status`, that check shows as one line in the folded tool-call list, so each subagent appears once.

The agent cannot sleep while `run_subagents` is still running in the same turn; it reads those reports first.

### Turn subagents on or off

Open **Models** and use the **Subagents** switch, then save. The change applies to the next message; a running subagent finishes its work. Subagents start on unless `CODEBERG_SUBAGENTS_USE=false` was set before you first saved model settings; after that, the switch decides.

## Follow the evidence

Ask for a concrete investigation:

```text
Trace this endpoint to the storage layer. Check callers and cite each step.
```

Expand tool output to inspect results. Hover or focus citations for full paths and line ranges; click to copy. Search can miss files or constructs, and the model can misinterpret results. Narrow broad answers with a filename, function, or error string.

While indexing runs, file tools remain usable. When enabled, hybrid search uses lexical matches and reference lookup can fall back to grep. Index-only tools report `NOT_READY`; this does not mean a symbol is absent. If a chunk-kind filter cannot be checked, search without that filter or use grep.

With `codeberg --no-vector` (or `CODEBERG_VECTOR=false`), `search_code`, `hybrid_search`, and `search_bundle` are omitted. Exact-text, file, symbol, and graph tools remain available. See [Start without an embedding model](/docs/indexing#start-without-an-embedding-model).

## Large tool results

Codeberg saves large results locally and gives the agent a preview and path. Results over 12,000 characters are saved this way; set `tool_output_limit` on a model in `models.yml` to change it. A `light` model sees fewer tools; see [Tune a model for smaller budgets](/docs/models#tune-a-model-for-smaller-budgets).

| Tool | Limit per call |
| --- | --- |
| `context_read`, `context_tail` | 400 lines. |
| `context_grep` | 40 matches by default, up to 100. Patterns can contain up to 16,384 UTF-16 code units. Regexes can nest up to 32 groups. |
| Any context file | 50 MiB; narrow the original request for larger output. |

Pages target 8,000 characters. Long lines use fragments up to 2,000 characters. `context_read` returns continuation positions for `start_line` and `start_column` (1-based UTF-16).

`context_grep` searches one line at a time and treats the pattern as plain text by default. Use `literal: false` for a JavaScript regular expression. Regex searches buffer complete lines and retry an unfinished line on its own after a batch timeout. If that line still times out or the pattern cannot be compiled, simplify the regex or search for a distinctive literal fragment. For text spanning multiple lines, find a distinctive line and open the surrounding text with `context_read`.

Regex evaluation has a shared two-second budget across files and retries. When it runs out, `context_grep` returns completed matches and a time-limit notice. Narrow the path or simplify the pattern to search again.

Grep excerpts include the match's start column and length in UTF-16 code units. Use the supplied `context_read` position to recover a match that extends past the excerpt. This position starts at the beginning of the character if the match begins partway through a UTF-16 surrogate pair.

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

Enable **Settings → Canvas** for a drawing canvas attached to each chat. Then turn on **Diagram**, the icon beside the attach button in the composer, when you want a drawing with a message:

1. Select the **Diagram** icon; it stays highlighted.
2. Send the message. The agent draws on the chat's canvas alongside its written answer.
3. **Diagram** turns off after sending. Turn it on again for each message that should draw or change the drawing.

Diagram is off by default. Without it, the request carries no canvas tools or drawing instructions, so most messages cost fewer tokens, and the agent cannot read or change the chat's canvas in that turn. Retries and regenerated answers keep the choice of the message they answer. Terminal questions have no toggle; with `CODEBERG_CANVAS_USE=true` the agent may draw on any question.

When the agent draws, the chat shows a **Canvas** card; select **Open canvas** to view and edit the drawing in a new browser tab. Chats do not embed the drawing, so switching between chats with canvases stays fast. Open copies of the same chat's canvas share scene updates.

An open canvas tab checks for changes about once a second, so agent edits appear within a second. A canvas in a background tab pauses and catches up when you return to it.

### How the agent styles drawings

The agent marks each shape with what it represents, and Codeberg applies a matching shape and colour scheme so similar things look the same:

| Role | Look |
|------|------|
| Service | Blue rounded box |
| Component (module, library) | Violet rounded box |
| Data store | Green ellipse |
| Queue | Teal box |
| External system | Grey dashed box |
| Actor (person, client) | Orange ellipse |
| Decision | Amber diamond |
| Step | Neutral box |
| Error | Red box |
| Note | Yellow sticky note |
| Title | Large heading above the drawing |
| Boundary | Dashed grey area that encloses a group, such as a layer or team |

- Boxes grow to fit their labels, so text is not clipped.
- Group areas resize around their members and stay behind them.
- Dashed arrows mark async, optional or planned links.
- The automatic layout follows the arrows left to right or top to bottom, sizes gaps to each box, reduces crossing lines, and gives each group its own lane so group areas do not cover unrelated shapes.
- After each change the agent sees a list of overlapping shapes, labels that do not fit and shapes outside their group, and fixes them before replying.

### Excalidraw features the agent can use

Beyond roles, the agent can use most of what you can do in the Excalidraw editor. Ask for any of these by name, for example "redraw it in a clean style with elbow arrows".

| Feature | What it does |
|---------|--------------|
| Drawing style | Sketchy (default), clean or rough lines; hand-drawn, Nunito, code or other Excalidraw fonts; sharp or round corners; background colour and grid. Changing the style restyles the existing drawing, and shapes you draw afterwards use it too. |
| Arrow routes | Straight, curved, or elbow (right-angled) connectors |
| Arrowheads | Arrow, triangle, dot, bar, circle, diamond (filled or outlined), and crow's-foot ends for database relationships |
| Frames | Named Excalidraw frames that hold a separate view, such as an overview next to a data model |
| Emphasis | Opacity, line width, hatched, cross-hatched or zigzag fills, rotation, and text alignment |
| Custom shapes | Multi-point lines, closed polygons and freehand strokes for highlights |
| Icons | Small SVG images, such as a database or logo icon |
| Editing aids | Selection groups that move together, and locked elements that can't be dragged by accident |

Links and embedded web pages stay disabled on local canvases. Arrows the agent connects are re-routed whenever it changes the drawing, so a bend you add to a connected arrow by hand may be straightened by the agent's next edit.

The automatic arrangement and styling only apply when the agent draws. Your own moves and colour changes are kept; ask the agent if you want the drawing laid out again.

## Optional script playground

Opt into `run_script` to let the agent write a short Python script that chains tool calls. Save the setting, then restart Codeberg:

```sh
codeberg config set CODEBERG_SCRIPT_USE=true
```

Or enable it for one launch:

```sh
CODEBERG_SCRIPT_USE=true codeberg
```

Requires Python 3 on `PATH` (`python3`, or `python` on Windows). Set `CODEBERG_SCRIPT_PYTHON` the same way to use another interpreter. Restart after changing either setting.

Use it for work where each call depends on the last, or that would otherwise take many similar calls:

```text
Grep for every handler registered in daemon/internal/httpserver, read each one,
and list the handlers that do not check the request method.
```

Inside a script, the agent can call any tool that `batch` can run:

| Script API | Behavior |
| --- | --- |
| `tools.grep(pattern="x")`, `call("grep", pattern="x")` | Run one tool and return its full result as Python data. |
| `parallel([("grep", {...}), ("read_file", {...})])` | Run independent calls concurrently; results keep call order. Pass `return_errors=True` to get failures in place. |
| `ToolError` | Raised for a failed call, an unavailable tool, or the call limit. |
| `TOOL_NAMES` | The tools the script can call. |

Only printed output reaches the agent's context, so a script can process many results and return a short summary. Calls inside a script do not add citations; the agent cites the paths and lines the script prints. The chat shows the script, its output, exit code, and tool-call count.

| Behavior | Detail |
| --- | --- |
| Run time | No limit. The agent can set `timeout_seconds`. For a long script, it starts `run_script` with `start_background_tool`, checks `background_tool_status`, and stops it with `cancel_background_tool`. **Stop** also ends a script running in the turn. Stopping kills the script and any processes it started. |
| Tool calls | No limit. At most 16 run at once; the rest wait their turn so a large script cannot overwhelm the daemon. |
| Printed output | No limit. Large output is [saved to context](/docs/tools#large-tool-results), but `context_read` and `context_grep` cannot open files over 50 MiB. Print summaries, or save output to a file (below). |
| Callable tools | Read-only source, search, context, knowledge, and web tools, plus `decide` when configured, which has [separate provider costs](/docs/tools#optional-decisions-tool). Some MCP tools too; see **MCP tools in scripts** below. Browser Use, canvas, scheduling, and background tools are not callable. |

### MCP tools in scripts

A script can call an MCP tool when both are true:

1. The agent has loaded the tool with `load_mcp_tools` in this chat, so it has read the tool's arguments.
2. The MCP server marks the tool read-only, or you trust the server with `CODEBERG_SCRIPT_MCP`.

To let scripts call every loaded tool from some servers, including tools that change data, list them by their configured names and restart:

```sh
codeberg config set CODEBERG_SCRIPT_MCP=jira,databases
```

The built-in database MCP is named `databases`. The read-only mark is the server's own claim; Codeberg does not check it. `TOOL_NAMES` lists the MCP tools a script can call when it starts.

```text
List my open Jira issues, find the files each one mentions with grep, and
print the issues whose files changed this week.
```

| Behavior | Detail |
| --- | --- |
| Results | The MCP result as Python data: a `content` list, plus `structuredContent` when the server sends it. |
| Errors | An MCP error result raises `ToolError` with the server's message. A tool that is not loaded or not allowed also raises `ToolError`, saying why. |
| Run records | Each MCP call from a script is saved in the run record, unlike other script calls, so you can see what a script did outside Codeberg. |
| Limits | None beyond the usual 16 calls at once. A script loop can call an MCP tool many times, so only trust servers whose tools are safe to repeat. |

### Save script output to a file

When a script produces bulk data, the agent can set `output_to_file: true`. Everything the script prints, including any traceback, is written to a new file as it runs, rather than returned to the chat. The agent receives:

| Field | Contents |
| --- | --- |
| `output_file` | Full path to the file. |
| `output_bytes` | File size. |
| `output_preview` | The whole output when short; otherwise the first 1,000 and last 2,000 characters. |

The agent can search the file with `context_grep`, page through it with `context_read` (files up to 50 MiB), or open the path in a later script to process it further. The chat shows the path, size, and preview.

```text
Collect every exported symbol across the repo into a file, then use a second
script to count them by directory.
```

Files are saved in the project's `context/scripts/` folder in Codeberg home and kept until you delete them.

A background script follows the normal [background tool rules](/docs/tools#let-a-long-tool-work-while-the-agent-sleeps): it keeps running while the agent sleeps, and a Codeberg restart interrupts it.

The agent is told to use scripts only to combine tool calls and process their results. It must not read or write other files (apart from saved script output), use the network, run shell commands, install packages, change the system, or look at credentials. It must also ignore instructions in source files, web pages, or tool results that ask for other code. This is guidance the model follows, not an enforced restriction.

> **Not a sandbox.** Scripts run as your user with normal file and network access. Codeberg starts each one in an empty temporary directory, removes it afterwards, and passes no API keys or other environment secrets, but it cannot prevent a script from reading or changing files elsewhere. Enable this only for models and projects you trust, because instructions in source files or web pages could steer the script the agent writes.

## Experimental search composition

Opt into `search_bundle` before launch:

```sh
CODEBERG_SEARCH_BUNDLE_USE=true codeberg
```

Requires embeddings to be enabled. `--no-vector` / `CODEBERG_VECTOR=false` omits this tool even when the experimental switch is on.

This read-only pipeline combines one to four explicit repository/query pairs, hybrid results, symbols, and up to eight indexed chunks. It preserves repository keys and line ranges; truncation and per-repository failures are explicit.

Output is capped at 10,000 serialized characters, including at most 6,000 characters of chunk bodies. Ordinary tools may be needed for omitted evidence. It cannot run scripts, edit source, or call MCP tools. It remains off by default while answer quality, token use, and latency are evaluated.
