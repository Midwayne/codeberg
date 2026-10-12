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

If an answer is too broad, narrow the request with a filename, directory, function, error string, or expected behavior. A follow-up such as “Check the caller too” or “Show the source behind that claim” helps the agent verify the next link.

## Optional web tools

When web tools are enabled, the agent can search the web and fetch URLs. Web search uses a launcher-managed SearXNG instance or `CODEBERG_SEARXNG_URL`. Initial setup may continue in the background; web search can be unavailable until a later launch.

Set `CODEBERG_WEB_USE=false` to disable web search and URL fetching. This does not disable source search. A model can still use its prior knowledge, so ask it to distinguish source evidence from general explanations.

## Skills and external tool catalogs

[Skills](/docs/skills) describe a workflow; they do not add callable source or service operations. MCP servers provide additional tool catalogs. The agent loads relevant MCP tools on demand rather than sending every server's full catalog with each request.

An extension may require its own executable, credentials, network access, or service permissions. Describe the outcome you want and any boundaries, especially when a connected tool can change data.
