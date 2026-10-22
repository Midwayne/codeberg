Codeberg keeps global configuration in its **home directory**, normally `~/.codeberg`. Set `CODEBERG_HOME` before launching if you want another location. Project data lives beneath that home and is separate from your source files.

## Find and edit settings

```sh
codeberg config
codeberg config edit
codeberg config set CODEBERG_WEB_PORT=48088
codeberg config unset CODEBERG_REASONING
```

`config` shows resolved values with secrets masked. `edit` opens the config in your editor. `set` saves a `KEY=VALUE`; `unset` removes that saved key. A value still exported in your shell can take precedence after you unset it in the file.

**Settings → Open config directory** opens the global directory in your file manager; on a machine without a desktop, use the displayed path manually.

> **Keep credentials private.** The config is a local text file, not an encrypted credential vault. Keep it out of version control. `codeberg config` masks displayed secrets; the saved file still contains their real values.

## Understand precedence

For launcher settings, the highest-priority source wins:

1. Command-line flags, such as `--model`, `--root`, or `--no-vector`.
2. Process environment variables.
3. The home directory's `config` file.
4. Built-in defaults.

Restart after editing launcher settings. Changes made through **Models** or project **Settings** follow their own save behavior and usually apply to the next request. The launcher passes configuration to its child processes; `.env` files in the source tree are for the separate `make run-*` development commands.

Choose a different home with the `CODEBERG_HOME` process environment or the `--home` flag **before** launching. Putting it inside a config file does not relocate the file the launcher already opened. For a one-off custom file, the launcher also accepts `--config /absolute/path/to/config`.

## Common launcher settings

| Setting | Purpose |
| --- | --- |
| `CODEBERG_MODEL` | Initial chat model as `provider:model`; optional for opening docs or with a model catalog. |
| `CODEBERG_SUBAGENT_MODEL` | Initial background learning model; defaults to the chat model. |
| `CODEBERG_REASONING` | Initial chat reasoning effort. |
| `CODEBERG_WEB_PORT` | Browser server port; default `48088`. |
| `CODEBERG_HTTP_PORT` | Daemon port through the launcher; default `48080`. |
| `CODEBERG_REPO` | Developer override for Codeberg's own checkout; normally auto-discovered. |
| `CODEBERG_VECTOR=false` | Disable embeddings for this launch. |
| `CODEBERG_EMBEDDING_MODEL` | Embedding model selection; see Indexing and search. |
| `CODEBERG_WEB_USE=false` | Disable the agent's web search and URL-fetch tools. |
| `CODEBERG_WEB_SEARCH_USE=true` | Opt into web search, which defaults off. Settings → Tools saves the browser preference separately. |
| `CODEBERG_MCP_USE=false` | Disable servers loaded from `mcp.json`. |
| `CODEBERG_LEARNING_USE=false` | Disable learning, history, feedback, and background extraction. |
| `CODEBERG_DBMCP_USE=true` | Enable the optional built-in database MCP server. |

The daemon port is `8080` when running `codeberg-d` directly. `CODEBERG_DAEMON_URL` lets a separately launched agent connect to another daemon endpoint. `codeberg --help` lists flags; `codeberg config` shows the resolved settings for your launch.

The complete [Environment variables](/docs/environment) reference covers credentials, context limits, ports, embeddings, remote vector storage, web tools, MCP, learning, and developer settings. Each category identifies whether values work in the saved config or must be exported in the shell.

## Know which files to change

| File in Codeberg home | Used for |
| --- | --- |
| `config` | Launcher configuration and provider credentials. |
| `models.yml` | Allowed model choices, capabilities, windows, and optional prices. |
| `model-settings.json` | Saved browser model selections; managed by the app. |
| `tool-settings.json` | Global Web search preference; managed by Settings → Tools. |
| `mcp.json` and `skills/` | Extensions shared across all projects. |
| `projects.json` | Project catalog, roots, and startup default; managed by the app. |
| `projects/<id>/` | One project's chats, knowledge, indexes, and extensions. |

Use the UI to add, rename, and delete projects rather than editing catalog IDs. **Settings → Projects** shows each project's exact config directory. Repository-local extensions can also live in `.codeberg/`, `.cursor/`, or `.agents/` as described in [MCP servers](/docs/mcps) and [Skills](/docs/skills).

## Files you can edit

Paths below are relative to Codeberg home, normally `~/.codeberg`, unless they explicitly name a source repository or your user home.

| File or directory | What to edit | When it applies |
| --- | --- | --- |
| `config` | `KEY=VALUE` startup settings and supported provider credentials. Comments begin with `#`; an optional `export` prefix is accepted. Values are literal, with no shell variable expansion. | Restart Codeberg. Use `codeberg config edit` or `codeberg config set`. |
| `models.yml` | Provider/model catalog, context windows, supported inputs, reasoning efforts, and optional prices. | Save valid YAML; the browser refreshes available choices. See [Models and credentials](/docs/models). |
| `mcp.json` | Global MCP servers in a `mcpServers` object. | Available on a subsequent chat turn. Editing in Settings avoids changing the wrong scope. |
| `skills/<name>/SKILL.md` | Shared reusable instructions, with a name and description in YAML frontmatter. Flat Markdown skill files are also accepted. | Discovered on a subsequent chat turn. See [Skills](/docs/skills). |
| `projects/<id>/mcp.json` | MCP servers for one stored project. | Overrides earlier definitions with the same server name for that project. |
| `projects/<id>/skills/` | Skills for one stored project. | Overrides matching global and repository skills for that project. |
| `projects/<id>/spec.yml` or `spec.yaml` | Built-in database MCP connections and access levels. Use environment placeholders for connection secrets. | Restart after updating the spec; requires database MCP to be enabled. |
| `spec.yml` or `spec.yaml` | Global or legacy database MCP spec used when the configured scope points here. | Check the effective project's config directory and any `CODEBERG_DBMCP_SPEC` override. |

Use **Settings → MCP servers** or **Settings → Skills** to edit either the current project or **All projects**. Those forms write the corresponding stored config; the repository's `.cursor` and `.agents` directories are separate discovery locations.

### Files inside a source repository

| Repository path | Purpose |
| --- | --- |
| `.cursor/mcp.json`, `.codeberg/mcp.json` | Repository-local MCP definitions. `CODEBERG_MCP_CONFIG` can point at additional files elsewhere. |
| `.agents/skills/`, `.cursor/skills/`, `.codeberg/skills/` | Repository-local skills. Each skill can be a Markdown file or a directory containing `SKILL.md`. |

Global skills can also be discovered in your user home's `~/.agents/skills` and `~/.cursor/skills`. Later discovery roots override earlier skills by name; stored project skills are checked last. See the dedicated [MCP](/docs/mcps) and [skills](/docs/skills) guides for discovery order and examples.

## Files managed by the app

These are useful to locate for backup or troubleshooting. Prefer their UI controls over editing JSON or generated data while Codeberg is running.

| File or directory | Contents | Use this control |
| --- | --- | --- |
| `model-settings.json` | Saved chat and learning model selections and reasoning efforts. | **Models** in the header. |
| `tool-settings.json` | Global Web search switch, off by default. Disabling stops managed search; changes to agent tools apply on a new chat turn. | **Settings → Tools**. |
| `projects.json` | Browser project catalog, roots, IDs, and startup default. | **Add project** and **Settings → Projects**. |
| `repos` | Terminal repository registry used by `--all` and `--repos`, stored as tab-separated key/path records. | `codeberg repos` and terminal repository runs; this is separate from the browser catalog. |
| `projects/<id>/learning/settings.json` | Per-project learning preferences. | **Settings → Learning**. |
| `projects/<id>/web-sessions/` | Saved conversations. | The chat sidebar and chat actions. |
| `projects/<id>/context/`, `projects/<id>/learning/`, `projects/<id>/canvas/` | Retrieved context, knowledge and datasets, and drawings when enabled. | Chat, Learning, Training review, and Canvas controls. |
| `projects/<id>/index/` | Derived chunks, graph and vector sidecars. | Project indexing and resource cleanup. |
| `projects/<id>/logs/`, `logs/`, `usage/` | Diagnostic logs and recorded usage. | Settings resource and usage views; inspect files for diagnostics. |

Older upgraded workspaces can retain data at the home-level paths while migration is pending. Use the exact project paths shown in Settings rather than assuming an ID or moving files by hand.

## Appearance

Open **Settings → Appearance** to change the theme. **Dark** uses Codex-inspired soft charcoal surfaces and muted off-white text; **Light** uses soft grey surfaces and charcoal text. Both use subtle separators and visible keyboard focus indicators. Kanagawa, Tokyo Night, Catppuccin Mocha, Dracula, Nord, and Gruvbox are also available.

Theme changes apply immediately across chat, settings, and docs. The choice is saved in this browser's local storage, separately from your Codeberg config, and restored on reload. Dark is the default. Appearance and docs are available before you add a project or configure a model. If browser storage is blocked, the theme can still change for the current page but may not survive a reload.

## Development env files

When using a source checkout's Make targets, `daemon/.env` configures `make run-daemon` and `agent/.env` configures the agent run targets. Their `.env.example` files are templates. They are not loaded automatically by the standalone daemon or by the `codeberg` launcher; export values when starting components directly.

Copy only the settings you need. A cloud chat provider needs its key in the agent environment; chunk-only daemon operation needs no chat key or ONNX model. The source references `launcher/internal/config/config.example` and `core/docs/CBERG_INDEX.md` provide developer detail, while the [environment reference](/docs/environment) explains the user-facing choices.
