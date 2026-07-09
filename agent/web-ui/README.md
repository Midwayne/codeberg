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

## Layout

```
src/
  components/
    workspace.tsx   useChat + session sidebar + auto-save
    chat.tsx        message list, prompt input, hook autocomplete
    message.tsx     renders text, reasoning, tool parts
    tool-views.tsx  rich cards for daemon tools (search, grep, files, git, …)
  lib/
    sessions.ts     CRUD client for /api/sessions/*
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
