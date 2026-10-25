Source files stay in the directory you add. Codeberg stores configuration and derived data under `CODEBERG_HOME`, normally `~/.codeberg`.

## Local storage

```text
~/.codeberg/
  config, models.yml, model-settings.json, tool-settings.json
  mcp.json, skills/, projects.json
  projects/<id>/
    web-sessions/          # Saved chats
      .runs/              # Search status, tool outcomes, response events
    context/              # Retrieved text, archives, checkpoints
    learning/             # History, knowledge, datasets, evaluations
    canvas/               # Drawings, when enabled
    index/                # Derived search data
    logs/
    mcp.json, skills/, spec.yml
  usage/, logs/
```

**Settings → Projects** shows exact IDs and paths. Chats, context, datasets, and logs can contain private source and attachments; treat the home directory as private data. Appearance stays in browser local storage.

Context checkpoints reuse summaries only while saved messages and model policy match. Original messages remain in `web-sessions/`.

Search journals retain request identity, tool starts/outcomes, and ordered events. Each has a **32 MiB** limit; reaching it stops the run with an error. Narrow the investigation. Deleting a chat, including age-based cleanup, removes its journals; active runs block deletion.

After restart, saved tool outcomes remain but generation does not resume automatically. A start without an outcome is uncertain. See [Chats](/docs/chats#recover-a-connection).

## Browser files

Browser Use creates temporary profiles, task files, and downloads outside project storage. Retained sessions keep them until closure; IDs are in memory and do not survive restart. Closing the session, cancelling its active task, or deleting its chat/project removes the temporary directory. A crash may leave files for the operating system to clear.

uv caches runtime dependencies separately in its user cache. Browser results may remain in chats, journals, and context. See [Browser Use](/docs/browser-use).

## Data sent to services

The folder picker does not upload your repository. Configured services receive the data needed for their requests:

| Service | Data that can leave the machine |
| --- | --- |
| Cloud chat/learning provider | Prompts, source excerpts, conversation history, attachments. |
| Remote vector backend | Vector data; local sidecars are still needed. |
| MCP server | Inputs sent to its tools. |
| Web search / URL fetching | Network requests to configured services and destinations. |
| Browser Use model provider | Task instructions, page content, screenshots when enabled. |

Local models use the endpoints you configure. Browser Use's worker/browser run locally; screenshots default off, and its cloud sync and telemetry are disabled. Codeberg's HTTP services bind to loopback.

The docs are bundled locally and require no LLM, project, or external documentation service.

## Back up or move data

Stop Codeberg before copying its home for a consistent backup. Include project storage to retain chats and knowledge. Back up source repositories separately; Codeberg home does not contain a copy of them.

Changing `CODEBERG_HOME` selects another config/catalog without moving existing data. Project IDs follow canonical source paths, so moving a repository also changes its identity.

## Free up space

Open **Settings → Free up resources**, inspect the preview, and select what to remove. **Settings → Resource usage** shows memory, disk, and activity. Wait for active work if cleanup reports busy.

| Action | Removes | Retains |
| --- | --- | --- |
| Project: **Delete indexed files only** | Catalog entry and search indexes. | Chats, history, knowledge, config, source. |
| Project: **Delete entire history, including knowledge** | Catalog entry and all saved project data. | Source files; shared models, credentials, usage, extensions. |
| `codeberg clean-index` | Managed index caches. | Chats and learning data. |

Use app project deletion while the web agent runs so it can check active work. Rebuilding indexes may require another embedding pass. See [Projects](/docs/projects#delete-a-project).
