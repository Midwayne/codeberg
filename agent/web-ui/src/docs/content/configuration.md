Project data lives beneath Codeberg home, separately from your source files.

## Edit settings

```sh
codeberg config                                      # Show resolved values; mask secrets
codeberg config edit                                 # Open the config in your editor
codeberg config set CODEBERG_WEB_PORT=48088           # Save a value
codeberg config unset CODEBERG_REASONING              # Remove a saved value
```

**Settings → Open config directory** opens the directory. Without a desktop, use the displayed path manually.

The `config` file uses literal `KEY=VALUE` lines. Comments start with `#`; `export` prefixes are accepted. Shell variables such as `$HOME` are not expanded.

> **Credentials are plain text on disk.** Displayed values are masked, but the config is not an encrypted vault. Keep it private and out of version control.

## Precedence

Launcher settings use this order, highest first:

1. Command-line flags.
2. Process environment.
3. Codeberg home's `config` file.
4. Built-in defaults.

Restart after changing launcher settings. Unsetting a saved key does not remove an exported shell value. Settings saved through the app usually apply to the next request.

Select another home **before launch**:

```sh
codeberg --home /absolute/path/to/codeberg-data
```

You can also export `CODEBERG_HOME`. Putting it inside an already-opened config file does not relocate that file. Use `--config /absolute/path/to/config` for a one-off config file.

## Common settings

| Setting | Purpose |
| --- | --- |
| `CODEBERG_MODEL` | Initial chat `provider:model`; optional with a catalog or for reading docs. |
| `CODEBERG_SUBAGENT_MODEL` | Learning model; defaults to chat. |
| `CODEBERG_REASONING` | Initial chat effort. |
| `CODEBERG_WEB_PORT` | UI port; default `48088`. |
| `CODEBERG_HTTP_PORT` | Launcher daemon port; default `48080`. Direct `codeberg-d` uses `8080`. |
| `CODEBERG_VECTOR=false` | Skip embeddings and semantic search. |
| `CODEBERG_EMBEDDING_MODEL` | [Embedding selection](/docs/indexing). |
| `CODEBERG_WEB_USE=false` | Disable web search, URL fetching, and Browser Use. |
| `CODEBERG_WEB_SEARCH_USE=true` | Initial web-search preference; a saved app switch takes precedence. |
| `CODEBERG_MCP_USE=false` | Disable file-configured MCP servers. |
| `CODEBERG_DBMCP_USE=true` | Enable the separate built-in database MCP. |
| `CODEBERG_LEARNING_USE=false` | Disable knowledge, learning history, feedback, and dataset work. |

Use the [Environment variables](/docs/environment) reference for all keys, defaults, and settings that require a shell export. `codeberg --help` lists flags.

## Editable files

Paths below are relative to Codeberg home. **Settings → Projects** shows the exact directory for each project.

| Path | Edit | Applies |
| --- | --- | --- |
| `config` | Startup settings and supported provider credentials. | After restart. |
| `models.yml` | [Models](/docs/models), context windows, capabilities, efforts, optional prices. | When settings refresh. |
| `mcp.json` | Shared servers inside `mcpServers`. | Next chat turn. |
| `skills/<name>/SKILL.md` | Shared instructions; flat Markdown files also work. | Next chat turn. |
| `projects/<id>/mcp.json` | Project servers; override matching earlier definitions. | Next chat turn. |
| `projects/<id>/skills/` | Project skills; override matching earlier skills. | Next chat turn. |
| `projects/<id>/spec.yml` or `spec.yaml` | Database connections and access levels. | After restart; database MCP must be enabled. |
| `spec.yml` or `spec.yaml` | Global/legacy database spec, if selected by the effective scope or `CODEBERG_DBMCP_SPEC`. | After restart. |

Use **Settings → MCP servers** or **Skills** to choose the current project or **All projects**. For repository-local files and discovery order, see [MCP servers](/docs/mcps) and [Skills](/docs/skills).

## App-managed files

Use the app controls instead of editing these files while Codeberg runs.

| Path | Control or contents |
| --- | --- |
| `model-settings.json` | **Models**: saved choices and efforts. |
| `tool-settings.json` | **Settings → Tools**: web search, Browser Use, and screenshot preferences. |
| `projects.json` | **Add project**, **Settings → Projects**: catalog and startup default. |
| `projects/<id>/learning/settings.json` | **Settings → Learning**: project preferences. |
| `projects/<id>/web-sessions/` | Saved chats and search runs. |
| `projects/<id>/context/`, `learning/`, `canvas/` | Retrieved context, knowledge, datasets, and drawings. |
| `projects/<id>/index/` | Derived search data. |
| `projects/<id>/logs/`, `logs/`, `usage/` | Diagnostics and recorded usage. |
| `repos` | Separate terminal registry used by `codeberg repos`, `--all`, and `--repos`. |

Upgraded workspaces may retain home-level data until migration completes. Use Settings paths rather than guessing IDs or moving catalog files. See [Data and maintenance](/docs/storage) for backups and cleanup.

## Appearance

Choose **Settings → Appearance**. Dark is the default; Light, Kanagawa, Tokyo Night, Catppuccin Mocha, Dracula, Nord, and Gruvbox are available.

Themes apply immediately to chat, settings, and docs. They are saved in this browser's local storage. If storage is blocked, changes may last only until reload. Appearance works before model or project setup.

## Development env files

Source-checkout Make targets use `daemon/.env` for `make run-daemon` and `agent/.env` for agent run targets. Copy only needed values from `.env.example`.

The launcher and standalone daemon do not load these files automatically. Export values when running components directly. `CODEBERG_REPO` points to Codeberg's checkout; your source repository belongs in **Add project**.
