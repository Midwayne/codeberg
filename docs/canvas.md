# Shared local canvas

Codeberg's optional Excalidraw canvas lets you and the coding agent edit the same
persistent whiteboard. Use it for architecture, dependencies, request flows and
implementation planning. It is off by default.

Start Codeberg normally, open **Settings → Canvas**, and enable **local canvas**.
When enabled, the agent is instructed to draw diagrams automatically alongside text
for complex explanations, architecture, dependencies and flows. You can also ask
for a diagram directly, or request text only. Simple answers stay in text.
Drawing instructions explicitly require HUMAN READABLE diagrams, with generously
sized boxes, readable text, clear spacing and clean connections. Diagrams can grow
as large as needed; there are no prompt limits on dimensions, node counts or label
lengths. The agent is instructed to check text fit and overlaps and refine the
layout before presenting its explanation.
A canvas card appears directly in the response, followed by the explanation.
Each chat has exactly one canvas: no names, creation
form, selector or separate panel. Its card stays at the first drawing response;
later tool calls update that same preview without reloading it. The card shows
**Agent is editing…** while drawing tools run.
The inline preview keeps drawing controls hidden; **Expand canvas** opens the same
scene in a full-window Excalidraw editor, where you can edit alongside the agent.
The scene enters with a brief fade and a small upward settle. Incoming changes
crossfade over 180 ms with a brief **Canvas updated** indication, while manual
editing stays immediate. Reduced motion uses a fade-only entrance and static
update feedback; expanding with the keyboard skips the entrance transition.
The full-screen editor's top-left menu provides Excalidraw's built-in **Save to…**
and **Export image…** actions. Save an editable `.excalidraw` file or export a PNG
or SVG using its standard dialog. JPG and PDF are not provided by this version.

Reopening a saved chat restores its canvas. A new chat starts without a drawing.
Branching a chat takes an independent snapshot of its parent's current drawing;
subsequent edits do not affect the parent.

The editor runs on the existing agent web server at `/canvas?chat=<session-id>`.
Set `CODEBERG_WEB_PORT=3210` to use port 3210 for both chat and canvas.
Canvas URLs also pin `?project=<project-id>` so project and chat stay consistent.
There is no extra server or command to start.

## Configuration and storage

Settings apply per project and persist across restarts. Web agents load the new
tool set on their next turn. Tools already running check the switch again before
writing. CLI agents pick up availability at startup; restart a running CLI agent
after enabling canvas. `CODEBERG_CANVAS_USE=true` supplies the initial default
when no saved settings exist. A saved user setting takes precedence.

Files live in `<project-data-dir>/canvas/`, using Codeberg's `CODEBERG_PROJECT_HOME`
and project resolution conventions. For an unmigrated installation this is
`$CODEBERG_HOME/canvas` (default `~/.codeberg/canvas`).

- `settings.json` stores the feature toggle.
- `chat-<session-id>.excalidraw` stores one scene per conversation, its revision and modification time.

Legacy named scenes remain on disk but are not automatically assigned to a chat.

Scenes use the standard Excalidraw envelope: `type`, `version`, `source`,
`elements`, `appState` and embedded `files`. Additional `name`, `revision` and
`updatedAt` fields are Codeberg metadata. The files can be opened in Excalidraw.
Writes use a private temporary file, fsync and atomic rename. A cross-process lock
serializes mutations from CLI agents and the web server. If a process crashes
while holding the lock, reading/reopening remains possible; after verifying that
no Codeberg canvas writer is running, remove `canvas/.write-lock` to resume writes.
Malformed scenes are reported and preserved, rather than replaced with an empty
canvas. Disabling the feature keeps all existing drawings.

## Agent tools

| Tool | Purpose |
| --- | --- |
| `canvas_get` | Read compact entities, labels, coordinates and connections |
| `canvas_add` | Add rectangles, ellipses, diamonds, text, arrows and lines |
| `canvas_update` | Patch existing elements by semantic ID |
| `canvas_delete` | Delete IDs and their labels/attached arrows |
| `canvas_clear` | Empty a scene |
| `canvas_layout` | Arrange nodes in `horizontal`, `vertical` or basic `flow` layout |

Canvas tools resolve the current conversation automatically at execution time,
including when multiple requests share a pooled agent. A first tool call creates
the scene lazily. CLI tool sources have their own local conversation ID.
Mutations accept an optional `revision`; there is no canvas name or selection input.
Use the revision returned by `canvas_get`; a stale revision fails with a useful
conflict error. Mutations return metadata, not the entire scene. `canvas_get`
returns at most 100 entities by default, supports `offset`/`limit` (maximum 200),
and accepts `raw: true` for explicit full-scene access.

For example, `canvas_add` accepts:

```json
{
  "revision": 0,
  "elements": [
    { "id": "checkout", "type": "rectangle", "text": "Checkout API" },
    { "id": "inventory", "type": "ellipse", "text": "Inventory" },
    { "id": "availability", "type": "arrow", "from": "checkout", "to": "inventory", "text": "GET /availability" }
  ]
}
```

The canvas layer creates bound text labels, valid Excalidraw defaults and arrow
endpoints. IDs remain stable through browser editing. Manual coordinates and
stroke/background colors are supported. Flow layout is a simple bounded graph
layout; complex cycles may benefit from manual positioning.

A typical request is “Map the request flow for checkout availability.” The agent
searches the code, inspects this chat’s existing drawing if needed, adds discovered
services, connects flows and lays them out. The drawing appears inline automatically. Move a service, rename it or add a note in the editor,
then ask “Look at my canvas changes and continue mapping the system.” The next
`canvas_get` includes your edits.

## Synchronization and recovery

Browser changes debounce for 300 ms. Saves require the scene's base revision.
SSE checks this chat’s persisted state every 500 ms, so agent changes and other
local editor writes appear without refreshing. Reconnected browsers read the persisted
authoritative scene. Closing Codeberg ends its canvas streams cleanly.

Edits to different elements merge in the browser. Overlapping element edits,
and failed writes retain your local edits
and stop automatic saving. Use **Download my edits** to keep a recoverable
`.excalidraw` copy before choosing **Load saved canvas**. The browser also warns
before leaving a tab with pending edits. Check the visible save status before
closing an editor or disabling the feature.

The HTTP surface is `/api/settings/canvas` (GET/PUT), `/api/canvas/scene?chat=<id>`
(GET/POST), and `/api/canvas/events?chat=<id>` (SSE). Scene and stream requests
require a valid chat ID. Browser saves cannot change the scene’s conversation. Errors stay canvas-specific and
are logged through the existing agent lifecycle logger without scene contents.

## Offline behavior and security

The official React component and all required fonts/assets are packaged locally.
Build the UI once with `npm ci --prefix agent/web-ui` and
`npm run build --prefix agent/web-ui`; the build copies package fonts into the
served output. Runtime drawing, persistence and native canvas tools require no
internet, cloud storage, telemetry or hosted collaboration service. The canvas
page's Content Security Policy restricts connections, scripts and fonts to the
local origin. Embedded images use data URLs; external links and embedded web
content are rejected. Chat IDs and file paths are validated and requests are size-limited.

The web server binds to `127.0.0.1`. Canvas API requests also require localhost
Host headers and same-origin requests. The iframe and separate tabs share this
local service; “multiplayer” here means shared scene editing, rather than cloud
rooms or cursor presence.

Canvas tool inputs/outputs participate in the configured model conversation.
A hosted model still receives that context and requires a network connection.
To repeat the complete *agent* workflow offline, configure a local model provider;
the canvas itself does not make model calls or send drawings anywhere.

Verification: `make agent-check` includes canvas storage/tool/HTTP/SSE tests and
browser synchronization/merge tests. Browser editing was also exercised against
a temporary localhost preview, including a manual rename followed by an agent
mutation that retained the user change.
