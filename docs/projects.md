# Projects

The **Project** selector at the top of the chat sidebar chooses the repository
for this browser tab. On mobile, open the sidebar to find it. Use **Add project**
beside it, then **Choose folder** to open the operating system’s folder picker
on the computer running Codeberg. The selected absolute path fills the
**Directory path** field, which also accepts manual entry. Cancelling the picker
keeps the form and any previously entered path. No source files are uploaded.
On Linux, the native picker requires `zenity` or `kdialog` and a desktop session;
manual entry remains available when a native dialog cannot open. The launch
directory becomes the initial project;
`CODEBERG_ROOT` remains supported as the startup default.

Selection is stored in the tab's session storage and its `?project=` URL. Each
request captures the selected project ID. Other tabs can use other projects,
and a stream finishing after a switch still saves to its original project.
Chats, chat search, branches, feedback, knowledge, learning queues and datasets
belong to that project. Branches require a parent chat within the same project.
Global model choices and credentials continue to apply across projects.

## Names and config locations

Open **Settings → Projects**, choose **Rename**, then **Save name** to change a
project's display name. **Cancel** or Escape leaves the original name in place.
The same section lists every project's directory name, full repository path,
stable project ID, and absolute config directory. It also shows the path to
`projects.json`, which maps registered names and repository roots to their IDs.
Paths follow the configured `CODEBERG_HOME`, including custom locations.
The selected project is marked **Current project**. Copy controls beside paths
and IDs help locate config files; expand **Config files** for their purposes.

Names must contain 1–120 characters; surrounding whitespace is trimmed.
Renaming persists across restarts and updates the project selector immediately.
The ID, repository directory, chats, extensions, and indexes stay in place.
Project config lives in `projects/<id>/` (`mcp.json`, `skills/`, and `spec.yml`);
global config stays at the top of `CODEBERG_HOME`. Repository-local config and
explicit external config paths remain supported as described below.

## Deleting a project

Open **Settings → Projects**, then choose **Delete project** for a repository.
The confirmation offers two choices:

- **Delete indexed files only** (default): remove the project from the catalog
  and delete its search indexes. Keep chats, history, knowledge, learning data
  and project configuration. Adding the same repository again reuses its saved
  knowledge and history while rebuilding the index.
- **Delete entire history, including knowledge**: permanently delete the
  indexes and all project-owned chats, context, knowledge, learning data, logs
  and configuration. Adding the repository again starts with fresh project data.

Repository directories and source files stay on disk. Global credentials,
models, extensions and usage accounting remain global. Cancel or Escape closes
the confirmation without deleting anything. Active requests and background
learning must finish before deletion; a busy error leaves the project available
and can be retried.

Deleting the current project selects another registered project. Deleting the
last project shows **Add project**. Deleted startup projects remain removed
across daemon restarts until explicitly added again. The catalog retains only
removed IDs and any legacy index namespace needed for compatibility; it does not
retain deleted project history or knowledge.

## Indexing

Each project has its own supervised indexer, vector namespace and file watcher.
The startup project begins immediately; other indexers start when first used.
During initial indexing, the UI shows readiness and the available chunk count.
Saved chats remain readable and the composer accepts drafts; sending and
regenerating wait for readiness. Large repositories or embedding models can
require several minutes. The display reports available chunks, rather than a
percentage of an unknown total.

An unavailable directory or prolonged index startup produces an error. Check
`projects/<id>/logs/indexer.log`, restore the directory or correct the indexer
configuration, then use **Retry**. The supervisor restarts failed processes;
Retry renews the readiness check. Activated indexers remain running until
Codeberg stops so different tabs retain their search and watching state.

## MCPs and skills

Open the **MCP servers** or **Skills** tab in **Settings** to view effective entries
or add one. Choose the current project’s name or **All projects**. MCP servers
accept the
existing JSON server configuration (command/args/env, or an HTTP URL); skills
accept a name, description and instructions. Changes apply to the next chat
turn. Existing streams keep their current tool connections until completion.
Existing file-based configuration remains supported.

In **Skills**, drop Markdown files onto **Import skill files** or use **Choose
skill files**. Codeberg previews their names and descriptions before **Import**
writes them into the selected scope. Select up to 20 UTF-8 `.md` files, 256 KB
each. A `SKILL.md` file needs a name in its frontmatter; other Markdown files can
use their filename as the name. Original contents and metadata are preserved.
Invalid files report individual errors; existing skills are never overwritten.
If only some imports succeed, failed files remain available for review or retry.

**Open config directory** at the top of Settings opens `$CODEBERG_HOME` in the
system file manager. On a computer without a desktop session, the UI displays
the directory path so it can be opened manually.

Discovery merges global configuration, the selected repository's existing
configuration, then project storage. Entries with the same name in project
storage take precedence. Existing `CODEBERG_MCP_CONFIG` files remain available.
Repository skills and MCP files stay in their repositories. Global skills under
`~/.agents/skills` and `$CODEBERG_HOME/skills` remain available in all projects.

## Storage and upgrades

`CODEBERG_HOME` still defaults to `~/.codeberg`. Stable project IDs derive from
canonical root paths, so directory aliases do not register duplicate projects.
Names are display labels, and a project retains its data across restarts.

```text
$CODEBERG_HOME/
  config, models.yml, mcp.json, skills/   # global settings and extensions
  projects.json                         # registered projects and startup default
  projects-migrated.json                # completed legacy data migration
  projects/<id>/
    web-sessions/
    learning/                           # memories, knowledge, queues, datasets
    context/                            # tool output, history, MCP catalogs
    mcp.json, skills/                    # project extensions
    spec.yml                            # built-in database MCP specification
    index/codeberg.usearch*             # local index and sidecars
    logs/                               # project agent, learning and indexer logs
```

On upgrade, the original workspace owns existing chats, context, learning data,
database specs and managed index caches. Existing multi-repository startup
configurations remain one project named **Existing workspace**, preserving their
repository keys and combined search behavior. New projects are independent.
The web server and CLI migrate durable data with a shared lock. Moves resume
after interruption; conflicting source and destination data stop migration
without overwriting either. A compatibility symlink for the original context
path preserves absolute references in older chats.

Global models, credentials, MCP configuration and skills stay global. Explicit
external index/spec paths remain attached to the original project. Remote
vector stores retain the original namespace on upgrade; new projects receive
separate namespaces. `codeberg clean-index` includes managed project caches
without removing chats or learning data. The initially configured IPC socket
and unscoped daemon endpoints remain compatible with existing clients.

Rebuild and restart both daemon and web agent together when upgrading. The web
agent gives an actionable startup error if the daemon lacks the project API.
The agent and learning CLI commands use their configured roots, or the startup
default when roots are absent; they never follow another browser tab's selection.
Direct `codeberg-search` can also address a project endpoint with `--daemon`.

## API

The daemon exposes `POST /projects/pick-directory` with an optional
`{"initialPath":"/absolute/directory"}` to open a native folder picker. The web
server proxies this as `/api/projects/pick-directory` without initializing a
project. It returns `{"path":"/canonical/directory"}` or `{"cancelled":true}`.
Selection does not add a project until the form is submitted. Cross-origin
requests are rejected; one dialog can be open across all tabs, with a five-minute
timeout. Unavailable native pickers return an error with a manual-entry fallback.

The daemon exposes `GET /projects` and `POST /projects` with
`{"root":"/absolute/directory","name":"Optional label"}`. Project repository APIs
use `/projects/<id>/health`, `/search`, `/tools` and `/tools/call`.
`PATCH /projects/<id>` with `{"name":"New display name"}` renames a project
without starting or restarting its indexer. It returns the updated project, 400
for an invalid name, or 404 for an unknown ID. Cross-origin changes are rejected.
`DELETE /projects/<id>` with `{"mode":"index"}` or `{"mode":"all"}` deletes a
project and returns the updated catalog. It stops the project indexer and removes
local caches and the project's configured remote vector namespace. Invalid
modes return 400; unknown IDs return 404. Failures return an error and keep the
project registered so deletion can be retried. The legacy migration owner ID
remains stable even if that project is removed. With no registered projects,
`defaultId` is empty and repository endpoints return 404 until a project is added.

`POST /projects/<id>/retry` renews the startup readiness window. Unscoped APIs
continue to address the startup project. Unknown project IDs return 404.

Web requests use the `X-Codeberg-Project` header. `/api/projects` manages the
catalog, and `PATCH /api/projects/<id>` proxies project renames.
`DELETE /api/projects/<id>` accepts the same deletion modes, closes the project's
web runtime and returns the updated catalog with config locations. Use this web
endpoint while the web agent is running, so active storage requests and learning
are checked before deleting data; busy projects return 409. Web catalog
responses include `catalogPath` and a `configDirectory` for each project, using
the web server's configured home. `/api/project/status` reports readiness,
`/api/project/retry` retries the check, and `/api/extensions` lists or adds
extensions. Existing requests without
a header use the startup default. Selection is request-bound; there is no
process-wide active-project mutation.

`POST /api/extensions/skills/preview` accepts `{"files":[{"filename":"SKILL.md",
"content":"…"}]}` and returns per-file names, descriptions, or validation errors
without writing any files. Imports use the existing project-scoped extension API.
`POST /api/config/open-directory` opens only the web server's configured global
config directory; browser-supplied paths are ignored. Both actions reject
cross-origin browser requests.
