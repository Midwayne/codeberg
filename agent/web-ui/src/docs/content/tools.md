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

Large tool results are saved locally with a preview and the full output's path. The agent can search these saved text files with `context_grep`, read selected lines with `context_read`, or inspect the end with `context_tail`. These tools support files up to **50 MiB** each. Reads and tails return at most 400 lines per call; grep returns at most 100 matches. Larger files are skipped or reported as too large, so narrow the original tool request when its output exceeds this limit.

Text is read in chunks, so a focused read or an early literal match can finish without loading the full file. Output pages target 8,000 characters, with long lines broken into fragments of up to 2,000 characters. `context_read` supplies continuation line and column positions; the agent passes these as `start_line` and `start_column` to continue inside a huge JSON line. Columns are 1-based UTF-16 positions. Grep returns an excerpt around a match and a position to inspect, rather than sending the entire huge line. Regex searches preserve whole-line matching and may buffer one long line; full-file searches and numbered tails may still scan the entire file.

If an answer is too broad, narrow the request with a filename, directory, function, error string, or expected behavior. A follow-up such as “Check the caller too” or “Show the source behind that claim” helps the agent verify the next link.

## Optional web tools

**Web search is off by default.** Open **Settings → Tools → Web search** to enable it for all projects. The preference is saved automatically, survives restarts, and can be changed before choosing a chat model or adding a project.

With the `codeberg` launcher, enabling search installs and starts a local SearXNG service in the background. Initial setup requires Git, Python 3 with venv/pip, and network access, and can take several minutes. The panel shows setup progress or a failure; search becomes available on a new chat turn once the service is ready. If setup fails, turn search off and on to retry, and check `logs/searxng.log` in Codeberg home.

Turning search off cancels setup and stops the launcher-managed search process immediately. It keeps the installed files so re-enabling does not require a fresh download. New chat turns omit `web_search`; an already-running turn keeps its original tool list and a search in progress may fail when the local service stops. Direct URL fetching (`fetch_url`) and source search remain available.

To use an existing service, configure `CODEBERG_SEARXNG_URL` and enable the switch. Its SearXNG configuration must allow JSON search responses. Turning the switch off disables Codeberg's use of that service; it does not stop an externally managed server. When running `codeberg-web` directly without the launcher, an external service is required for search.

`CODEBERG_WEB_SEARCH_USE=true` opts into search for terminal use and sets the browser's initial preference. A saved browser switch takes precedence over that initial preference. Merely setting a SearXNG URL does not enable search.

Set `CODEBERG_WEB_USE=false` to disable both web search and URL fetching. This master switch prevents enabling search in Settings until the launcher configuration is changed and Codeberg is restarted. Source search still works. A model can still use its prior knowledge, so ask it to distinguish source evidence from general explanations.

## Optional canvas

Enable **Settings → Canvas** to use a drawing canvas attached to each chat. Open copies of the same chat share scene updates, so extra browser tabs do not each poll and parse the scene every half second.

Changes normally appear shortly after a file update. On filesystems where notifications are unavailable or missed, a fallback check catches up within about 15 seconds. Closing the last connected canvas stops its watcher and timer.

## Skills and external tool catalogs

[Skills](/docs/skills) describe a workflow; they do not add callable source or service operations. MCP servers provide additional tool catalogs. The agent loads relevant MCP tools on demand rather than sending every server's full catalog with each request.

An extension may require its own executable, credentials, network access, or service permissions. Describe the outcome you want and any boundaries, especially when a connected tool can change data.

Indexing and graph creation do not block chat or file tools. During a build, `hybrid_search` uses lexical matches and `find_references` can fall back to grep. Index-only operations report `NOT_READY` promptly; the agent can continue with `grep`, `glob`, `read_file`, and directory tools. An unavailable index is not evidence that a symbol or file is absent.

A hybrid search restricted by chunk `kind` needs the index to classify lexical matches. If that lookup is unavailable, the tool reports the error rather than returning an empty result. The agent can search without the kind filter or use grep and read the matching source directly.
