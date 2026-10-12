Your source files stay in the directory you add. Codeberg stores its own configuration and derived data separately, under `CODEBERG_HOME`, normally `~/.codeberg`.

## What is stored locally

```text
~/.codeberg/
  config, models.yml, model-settings.json
  mcp.json, skills/
  projects.json
  projects/<id>/
    web-sessions/
    context/
    learning/
    index/
    logs/
    mcp.json, skills/, spec.yml
  usage/
  logs/
```

Chats, retrieved context, knowledge, datasets, and logs can contain information about your code. Treat this directory as private data. **Settings → Projects** provides the exact location and ID of each project's storage. Appearance preferences are saved separately in the browser's local storage.

The docs you are reading are bundled with the web UI. Reading them does not need an LLM call, an indexed project, or an external documentation service.

Topic links update within the docs view, keeping navigation in place. Keyboard navigation is immediate; the system's reduced-motion preference replaces movement with a brief fade.

Use **Search docs** in the header, or press **⌘K / Ctrl+K**, to search all documentation titles and full text. Results include matching sections and excerpts; **↑ / ↓** selects a result, **Enter** opens it at the matching section, and **Escape** closes search. This search works locally without a project or model.

## What can leave your machine

The folder picker does not upload a repository. However, when you use a cloud chat or learning provider, prompts and relevant tool results can include source excerpts, conversation history, and attachments sent to that provider. A local model uses the local endpoint you configured.

Remote vector backends store vector data outside your machine. MCP servers receive the inputs sent to their tools; web tools make network requests. Review the endpoints and credentials you configure. Codeberg's local HTTP services bind to loopback; access them on the machine running the app.

## Back up or move your data

Stop Codeberg before copying its home directory for a consistent backup. Keep credentials private, and include project storage if you want saved chats and knowledge. Source repositories need their own backup; they are not copied into Codeberg home.

Changing `CODEBERG_HOME` points the app at a different configuration and project catalog. It does not automatically move the old directory. Project IDs follow canonical repository paths, so moving a source repository is different from moving Codeberg's data directory.

## Free up space deliberately

Open **Settings → Free up resources**, review the cleanup preview, and choose the data to remove. Active work can block cleanup until it finishes. **Settings → Resource usage** helps inspect local memory, disk use, and activity.

For an entire project, use **Settings → Projects → Delete project**. The default retains history and knowledge while removing search indexes. The full-history choice permanently removes project data. Both leave source files alone. Global models, credentials, usage accounting, and extensions are separate from project deletion.

In the terminal, `codeberg clean-index` targets managed index caches without deleting chats or learning data. Use the app's project deletion flow when the web agent is running so it can check active requests and background work. Re-indexing can take time and may require another embedding pass.
