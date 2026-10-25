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
