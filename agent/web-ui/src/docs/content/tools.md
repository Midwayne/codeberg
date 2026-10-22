The agent uses tools to investigate your selected project. Your question is the task; tools are the operations it chooses while gathering evidence. You normally do not need to type a tool's arguments yourself.

## What built-in tools do

| Tool family | Typical use |
| --- | --- |
| `search_code` and hybrid search | Find source relevant to a question; semantic results need vector search. |
| `grep` and `glob` | Find exact text or paths. |
| `find_symbol` and chunk tools | Locate declarations and retrieve indexed pieces of code. |
| `read_file`, `head`, `tail`, and `sed` | Read current source or a focused range. |
| `list_dir` and `tree` | Understand directory structure. |
| `git_log` and `git_blame` | Inspect change history when the directory is a Git repository. |
| Context and knowledge tools | Reuse retrieved evidence or [accumulated codebase knowledge](/docs/knowledge) to improve later answers. |

The daemon's source tools are read-only and scoped to configured roots. They are not a general terminal or a source-code editor. Optional integrations add their own capabilities, so an [MCP server](/docs/mcps) may expose writes to an external service.

## Follow an investigation

Ask for a concrete path through the code: “Trace this endpoint to the storage layer and cite each step.” The agent can search for entry points, inspect symbols, read call sites, and connect the evidence. It may batch independent reads to reduce waiting.

Expand tool output in the conversation to see what was returned. Source citations identify paths and lines; inspect the actual source before acting on a conclusion. Search can miss unfamiliar naming, unsupported source constructs, or files that are not indexed, and a model can still draw the wrong inference.

Hover over a numbered citation or focus it with the keyboard to reveal its full source path and line range. Long paths wrap within the window. Click the citation to copy its source, or press Escape to dismiss the tooltip.

Large tool results are saved locally with a preview and the full output's path. The agent can search these saved text files with `context_grep`, read selected lines with `context_read`, or inspect the end with `context_tail`. These tools support files up to **50 MiB** each. Reads and tails return at most 400 lines per call; grep returns at most 100 matches. Larger files are skipped or reported as too large, so narrow the original tool request when its output exceeds this limit.

Text is read in chunks, so a focused read or an early literal match can finish without loading the full file. Output pages target 8,000 characters, with long lines broken into fragments of up to 2,000 characters. `context_read` supplies continuation line and column positions; the agent passes these as `start_line` and `start_column` to continue inside a huge JSON line. Columns are 1-based UTF-16 positions. Grep returns an excerpt around a match and a position to inspect, rather than sending the entire huge line. Regex searches preserve whole-line matching and may buffer one long line; full-file searches and numbered tails may still scan the entire file.

If an answer is too broad, narrow the request with a filename, directory, function, error string, or expected behavior. A follow-up such as “Check the caller too” or “Show the source behind that claim” helps the agent verify the next link.

## Experimental search composition

`search_bundle` is an opt-in, read-only evidence pipeline for investigations spanning repositories. Set `CODEBERG_SEARCH_BUNDLE_USE=true` in the environment before launching Codeberg, then restart. It is off by default while full-agent quality, provider-token usage, and latency are evaluated.

The agent supplies one to four explicit repository/query pairs. The tool runs hybrid searches, collects matching symbols and source locations, and reads up to eight selected indexed chunks. Results preserve repository keys and line ranges. The complete bundle is limited to 10,000 serialized characters, with at most 6,000 characters of chunk bodies; omitted results, truncated bodies, and per-repository failures are explicit. Lexical-only matches retain their context without inventing an indexed chunk ID.

This pipeline cannot run scripts, edit source, call MCP tools, or execute arbitrary commands. It uses the same registered repository boundaries as ordinary searches. Smaller output is not proof of a better answer: the agent may still need ordinary source tools to inspect omitted evidence. See [Environment variables](/docs/environment).

## Optional web tools

**Web search is off by default.** Open **Settings → Tools → Web search** to enable it for all projects. The preference is saved automatically, survives restarts, and can be changed before choosing a chat model or adding a project.

With the `codeberg` launcher, enabling search installs and starts a local SearXNG service in the background. Initial setup requires Git, Python 3 with venv/pip, and network access, and can take several minutes. The panel shows setup progress or a failure; search becomes available on a new chat turn once the service is ready. If setup fails, turn search off and on to retry, and check `logs/searxng.log` in Codeberg home.

Turning search off cancels setup and stops the launcher-managed search process immediately. It keeps the installed files so re-enabling does not require a fresh download. New chat turns omit `web_search`; an already-running turn keeps its original tool list and a search in progress may fail when the local service stops. Direct URL fetching (`fetch_url`) and source search remain available.

To use an existing service, configure `CODEBERG_SEARXNG_URL` and enable the switch. Its SearXNG configuration must allow JSON search responses. Turning the switch off disables Codeberg's use of that service; it does not stop an externally managed server. When running `codeberg-web` directly without the launcher, an external service is required for search.

`CODEBERG_WEB_SEARCH_USE=true` opts into search for terminal use and sets the browser's initial preference. A saved browser switch takes precedence over that initial preference. Merely setting a SearXNG URL does not enable search.

Set `CODEBERG_WEB_USE=false` to disable web search, URL fetching, and Browser Use delegation. This master switch prevents enabling search in Settings until the launcher configuration is changed and Codeberg is restarted. Source search still works. A model can still use its prior knowledge, so ask it to distinguish source evidence from general explanations.

## Browser Use delegation

**Browser Use is off by default.** Enable **Settings → Tools → Browser Use** for all projects, then start a new chat turn. You can change this setting before adding a project or choosing a model. Ask Codeberg for a browser task, for example: “Open https://example.com and report the page title.” Codeberg can call `browser_task`, passing the goal and constraints to a separate Browser Use agent. That agent navigates and interacts in its own loop, then returns its result and visited URLs to Codeberg. It does not create a separate chat.

**Only vision-capable browser models are eligible.** Declare `inputs: [text, vision]` on the model's entry in [models.yml](/docs/models#add-a-model-catalog). Entries without `inputs`, text-only entries, and unknown models cannot start browser sessions. Codeberg does not infer capabilities from a model name. The selected chat entry supplies its declared inputs; an explicit `CODEBERG_BROWSER_MODEL` override must match a vision-capable provider/model declared in the catalog. The main chat can be text-only when it delegates to a separate eligible browser model.

**Settings → Tools → Browser vision** controls screenshot access and defaults off. With it off, the browser agent works from page content without screenshots. Turning it on passes `use_vision=True` to Browser Use. The vision-capable-model requirement applies even when screenshots are off. Changes apply to the next delegated task, including follow-ups in retained browsers; an active task keeps its existing setting. `CODEBERG_BROWSER_VISION=true` sets the initial preference and enables screenshots for direct terminal use; a saved web setting takes precedence.

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and Chrome or Chromium **on the machine running Codeberg**. The first delegated task uses uv to install the pinned `browser-use` package (0.13.11). It accepts Python >=3.11 and <4.0, matching [Browser Use's requirements](https://pypi.org/project/browser-use/0.13.11/), so an installed Python 3.13 or later compatible version can be used. uv downloads Python only if no compatible interpreter is available; Python 3.12 is not specifically required. Network access and writable cache/temp directories are required for initial setup. Browser Use can attempt a Chromium download if it cannot find a browser; install Chrome/Chromium yourself if that fails. On Linux, a visible browser also requires a desktop session and the browser's system libraries. Set `CODEBERG_BROWSER_HEADLESS=true` before startup for a machine without a desktop.

Enabling the switch starts no browser or worker. A new session starts its own local worker and browser with a fresh temporary profile. Tasks close the browser by default. Ask explicitly to keep it open, for example: “Open https://example.com and leave the browser open so I can inspect it.” Codeberg sets `keep_open=true` on `browser_task` and receives a `session_id` with `kept_open=true`. The local browser and its tabs remain available for you to inspect or use after the task completes. A headless browser remains invisible.

Ask “Continue in that browser” to reuse its tabs, cookies, logins, and temporary files. Codeberg passes the returned `session_id` to `browser_task`. A follow-up in a retained session keeps it open by default; `keep_open=false` closes it after that task. `browser_sessions` lists retained browsers in the current chat, and `browser_close` closes one without starting another agent task. Asking “Close that browser” uses the close tool. An idle retained worker waits for a command without running the agent loop or making model calls.

Retained sessions belong to the chat that created them. Another chat, including a fork, cannot use their IDs. They survive model changes within that chat and continue using the browser model and provider settings from session creation, even if the new chat provider cannot start a new Browser Use session. They are kept only for the current Codeberg process: explicit close, deleting their chat/project, disabling Browser Use, or shutting down Codeberg closes them and removes their temporary profiles and files. Closing an `Agent` also closes its directly owned sessions; one-shot CLI commands close them when the command exits. There is no idle expiration while Codeberg stays open. After a restart or closed session, its ID is stale; Codeberg reports that instead of silently starting a replacement browser.

Failure or **Stop** during an active browser task closes that task's browser, including a retained session being continued. Cancellation cannot undo completed actions. Stopping a different task does not close an already idle retained browser. The installed runtime/package remain cached for later tasks. No personal browser profile, cookies, or signed-in session is reused when starting a new session. Browser profile data, task files, and downloads last until the session closes; this integration returns text and URLs, not downloaded files or screenshots.

By default, the separate agent uses the selected chat model and that provider's credentials. To choose a different model, export `CODEBERG_BROWSER_MODEL=provider:model` before starting Codeberg. Supported providers are `openai`, `anthropic`, `google`, `ollama`, and `llamacpp`. Local models need to handle Browser Use's structured responses and screenshots; unsupported models may fail. `CODEBERG_BROWSER_UV` can supply the absolute uv executable path if it is outside Codeberg's PATH. These are environment variables, not entries in `models.yml` or the saved launcher config.

Browser Use settings remain available if the managed Web search control service is unreachable. The Tools panel shows the search service error while allowing you to enable or disable Browser Use independently. If stopping Web search cannot be confirmed, the panel reports that error rather than claiming the local service stopped.

The **browser and worker run locally**. With a remote model provider, task instructions and page content are sent to that provider; screenshots are also sent when Browser vision is enabled. Model usage is billed by the provider and is currently separate from Codeberg's **Model usage** totals. Browser Use Cloud and upstream telemetry/cloud sync are disabled. For local inference, select a suitable Ollama or llama.cpp model and a local endpoint.

Browser tasks can interact with websites, forms, and local web apps, including localhost; the `fetch_url` private-network setting does not restrict this separate browser. State the permitted actions and boundaries in your request. Cancellation cannot undo completed actions. Results distinguish completed, incomplete, and failed tasks; after an interruption, verify what happened before asking the agent to retry an action that changes data. Browser tasks are excluded from the read-only `batch` tool.

Codeberg waits for the Browser Use agent to return its result, including for long tasks and follow-ups. It makes no main-agent model calls while waiting and resumes the main agent when the result arrives. There is no Codeberg wall-clock deadline or fixed task step limit; Browser Use's own request timeouts, failure handling, and provider limits still apply. A task can remain active until it finishes, fails, or you choose **Stop**, close its browser session, disable Browser Use, or shut down Codeberg. Retained browsers also have no idle expiration. Turning the toggle off prevents cached agents from starting new browser tasks. `CODEBERG_BROWSER_USE=true` sets the initial preference for direct terminal use; a saved Settings toggle takes precedence in the web app. `CODEBERG_WEB_USE=false` disables Browser Use along with the other built-in web tools.

## Optional canvas

Enable **Settings → Canvas** to use a drawing canvas attached to each chat. Open copies of the same chat share scene updates, so extra browser tabs do not each poll and parse the scene every half second.

Changes normally appear shortly after a file update. On filesystems where notifications are unavailable or missed, a fallback check catches up within about 15 seconds. Closing the last connected canvas stops its watcher and timer.

## Skills and external tool catalogs

[Skills](/docs/skills) describe a workflow; they do not add callable source or service operations. MCP servers provide additional tool catalogs. The agent loads relevant MCP tools on demand rather than sending every server's full catalog with each request.

An extension may require its own executable, credentials, network access, or service permissions. Describe the outcome you want and any boundaries, especially when a connected tool can change data.

Indexing and graph creation do not block chat or file tools. During a build, `hybrid_search` uses lexical matches and `find_references` can fall back to grep. Index-only operations report `NOT_READY` promptly; the agent can continue with `grep`, `glob`, `read_file`, and directory tools. An unavailable index is not evidence that a symbol or file is absent.

A hybrid search restricted by chunk `kind` needs the index to classify lexical matches. If that lookup is unavailable, the tool reports the error rather than returning an empty result. The agent can search without the kind filter or use grep and read the matching source directly.
