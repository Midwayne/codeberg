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
| `CODEBERG_VECTOR=false` | Start [without embeddings](/docs/indexing#start-without-an-embedding-model); omit semantic search tools. One-launch flag: `--no-vector`. |
| `CODEBERG_EMBEDDING_MODEL` | [Embedding selection](/docs/indexing). |
| `CODEBERG_WEB_USE=false` | Disable web search, URL fetching, and Browser Use. |
| `CODEBERG_WEB_SEARCH_USE=true` | Initial web-search preference; a saved app switch takes precedence. |
| `CODEBERG_MCP_USE=false` | Disable file-configured MCP servers. |
| `CODEBERG_DBMCP_USE=true` | Enable the separate built-in database MCP. |
| `CODEBERG_LEARNING_USE=false` | Disable knowledge, learning history, feedback, and dataset work. |

Use the [Environment variables](/docs/environment) reference for all keys, defaults, and settings that require a shell export.

## Find commands and flags

| Command | Shows |
| --- | --- |
| `codeberg help` | Command overview, configuration subcommands, and common tasks. |
| `codeberg run --help` or `codeberg --help` | Startup flags, including `--no-vector` and `--vector`. |
| `codeberg build --help` | Build flags. |

Currently, launcher flag help prints usage and exits with status `1`. `codeberg help` exits normally. The command overview and flag lists are separate.

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

Choose **Settings → Appearance**. Graphite is the default.

| Themes | Style |
|--------|-------|
| Graphite, Porcelain | Clean dark and light neutrals with a faint halo of light |
| Midnight | Twinkling stars at three depths, with an occasional shooting star |
| Aurora | Drifting bands of northern light under faint stars |
| Snowfall | Snow falling at three speeds |
| Rainfall | Steady rain over a dim city glow |
| Fireflies | Glowing fireflies that float and blink |
| Lanterns | Warm lanterns rising slowly |
| Parchment | Serif headings and a faint paper grain |
| Ember | Serif headings and a warm glow behind the composer |
| Phosphor | Monospace text, square corners, and terminal scanlines |

A backdrop is the scene drawn behind the header, sidebar, and conversation; they sit over it as glass. Behind messages and the composer, moving scenes fade to a faint trace so they never compete with text; they show fully in the margins on either side. On narrow windows the whole scene stays faint. Turn off **Show backdrop** under the theme list to keep a theme's colors without its scene. Backdrops stop moving, and shooting stars are hidden, when your system asks for reduced motion.

Themes use fonts already on your device, so they look slightly different between operating systems.

Themes apply immediately to chat, settings, and docs. They are saved in this browser's local storage. If storage is blocked, changes may last only until reload. Built-in themes work before model or project setup.

### What a theme can change

| Area | What changes |
|------|--------------|
| Colors | Background, text, buttons, links, borders, and errors |
| Fonts | Headings, body text, and code, from fonts already on your device |
| Text size | 90% to 115% of the default |
| Header, sidebar, composer | Color, text, border, and how much of the backdrop shows through |
| Your messages, code blocks | Color, text, border, and corner shape |
| Backdrop | A scene behind the app, still or animated |
| Transition | How the app changes into the theme |

Describe any of these when you create or change a theme, for example `square code blocks and a glassier sidebar`.

### Create a theme

Describe a look and your chat model designs a theme: colors, fonts, corner shape, an optional backdrop, and how the app changes into it.

1. Add a project and choose a chat model.
2. Open **Settings → Appearance** and type a description under **Create a theme**, or choose an idea such as **Synthwave sunset**.
3. Leave **Animated** on for a moving backdrop, or turn it off for a still one.
4. To base a new theme on the one you are using, turn on **Start from** *theme name*.
5. Choose **Create theme**. It applies as soon as it is ready and appears under **Your themes**.

### Change a theme you created

1. Under **Your themes**, choose the pencil (**Edit**) on the theme.
2. Describe the change, for example `warmer colors, slower stars`, or choose an idea such as **More contrast**.
3. Choose **Apply change**. The theme updates in place; the rest stays as it was.
4. Keep describing changes, or choose **undo** to restore the previous version. Choose **Done** to stop editing.

Each theme uses a few thousand tokens on your chat model and is recorded in **Usage**. **Cancel** stops a request that is still running.

Codeberg checks every generated theme before using it: text and button labels are made readable, and anything it cannot use is replaced with a default. Generated backdrops get the same quiet area behind messages as built-in ones. You can save up to 12 themes in this browser; delete one with its trash button to make room for another. Generated themes are not shared between browsers.

If creation fails, check the chat model under **Models** and try again, or reword the description.

### Theme transitions

Changing themes animates the whole app. Each theme picks its own effect:

| Effect | Looks like | Used by |
|--------|------------|---------|
| Reveal | A circle grows from where you clicked | Parchment, Ember, Lanterns |
| Blur | The old theme dissolves through a blur | Midnight, Aurora, Snowfall |
| Wipe | The new theme scans in from the top | Phosphor, Rainfall |
| Fade | A crossfade | Graphite, Porcelain, Fireflies |

Browsers without view transitions fade the colors instead. When your system asks for reduced motion, themes change instantly.

## Development env files

Source-checkout Make targets use `daemon/.env` for `make run-daemon` and `agent/.env` for agent run targets. Copy only needed values from `.env.example`.

The launcher and standalone daemon do not load these files automatically. Export values when running components directly. `CODEBERG_REPO` points to Codeberg's checkout; your source repository belongs in **Add project**.
