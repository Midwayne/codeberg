# Codeberg web UI

React chat SPA for `codeberg-web`. Built with Vite, served by the Node HTTP server
in `agent/src/web/`.

## Prerequisites

- Node ≥ 22
- Running `codeberg-web` (or `make run-agent-web`) for the API
- Daemon (`codeberg-d`) for tool calls

## Development

```sh
# Terminal 1 — API + static fallback
cd .. && make run-agent-web

# Terminal 2 — Vite dev server with HMR
npm install
npm run dev
```

Vite proxies `/api/*` to `http://127.0.0.1:48088` (see `vite.config.ts`).

## Production build

```sh
npm run build    # output: web-ui/dist/
```

`codeberg-web` serves `web-ui/dist` by default (`CODEBERG_WEB_ROOT`). The launcher
runs `make build-web-ui` as part of `make build-agent`.

## Saved chats

The sidebar separates active and archived chats. The actions menu on each chat
lets you pin/unpin, archive/unarchive, or delete it. Use the header search button
or ⌘K/Ctrl+K to open a keyboard-navigable search dialog.
It searches titles and user/assistant message text across **all** chats, including
archived chats, with answers from the open chat listed first. Selecting a message
opens its chat and jumps to that message. Any chat can still be prompted normally;
pinning and archiving only change its sidebar organization. State is stored with
each conversation in `$CODEBERG_HOME/web-sessions/`.

## Layout

```
src/
  components/
    workspace.tsx   useChat + session sidebar + auto-save + branch
    chat.tsx        message list, prompt input, tick rail
    message-rail.tsx ChatGPT-style jump-to-prompt ticks on the right
    message.tsx     renders text, reasoning, tool parts
    tool-views.tsx  rich cards for daemon tools (search, grep, files, git, …)
  lib/
    sessions.ts     CRUD client for /api/sessions/*
    branch.ts       fork a transcript prefix into a new session payload
    commands.ts     fetches /api/commands for hook autocomplete
```

## Tool rendering

- **Search/index tools** — `search_code`, `hybrid_search`, `find_symbol`, `file_outline`, `get_chunk`, `search_graph` show path, lines, snippet cards (collapsed by default).
- **Graph tools** — `trace_path` and graph-backed `find_references` show hop/ref rows.
- **Lexical tools** — `grep` (and grep-fallback `find_references`) show match rows.
- **File/repo tools** — `read_file`, `glob`, `tree`, `repos`, etc. have tailored views; unknown tools fall back to JSON.
- **Reasoning** — collapsible when the model emits reasoning parts.

## Environment

Inherited from the parent `agent/.env` when using `make run-agent-web`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `CODEBERG_WEB_PORT` / `PORT` | 48088 | API + static server port |
| `CODEBERG_WEB_ROOT` | `../web-ui/dist` | Prebuilt SPA directory |
| `CODEBERG_HOME` | `~/.codeberg` | Web session storage (`web-sessions/`) |

See [../README.md](../README.md) for full agent configuration.
