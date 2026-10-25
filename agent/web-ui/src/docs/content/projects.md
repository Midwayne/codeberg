## Add a project

Run `codeberg`, then choose **Add project**. Select an existing directory on the Codeberg host with **Choose folder**, or enter an absolute path. On Linux, the picker needs `zenity` or `kdialog` and a desktop session; manual entry works without them.

Projects return on later launches. With no projects, the daemon stays idle and the app shows **Add a project to get started**. Codeberg's own directory is not automatically added.

For an explicit startup project:

```sh
codeberg /absolute/repository
# Or: codeberg --root /absolute/repository
```

## Switch projects

Use the sidebar's project selector; open the sidebar on phones. Selection belongs to the current tab and its `?project=` URL, so different tabs can use different projects.

Responses and queued follow-ups keep running in their original chats when you switch. Returning restores the selected chat and progress. See [Chats](/docs/chats).

## Scope and identity

| Project-specific | Shared |
| --- | --- |
| Source roots, watcher, indexes | Provider credentials and model choices |
| Chats, branches, feedback | Global MCP servers and skills |
| Knowledge, learning history, datasets | Usage accounting |
| Project MCP servers, skills, database spec | Appearance within the same browser |

IDs follow the canonical source path. Symlinks to the same directory share a project. Renaming its display label keeps history; moving the repository changes its identity. Do not merge histories by moving catalog files.

Older multi-repository startup configurations remain one **Existing workspace**, preserving their repository keys and combined search.

## Inspect or rename

Open **Settings → Projects** to see source paths, IDs, config directories, and current selection. Use the copy controls to locate files.

Choose **Rename**, edit the label, then **Save name**. **Cancel** keeps the original label.

## Delete a project

Choose **Settings → Projects → Delete project**.

| Option | Result when the same directory is added again |
| --- | --- |
| **Delete indexed files only** | Reuses retained chats, history, knowledge, and configuration; rebuilds search indexes. |
| **Delete entire history, including knowledge** | Starts fresh; saved project data is permanently removed. |

Both remove the catalog entry and leave source files on disk. Wait for active requests and background learning before deleting; retry a busy error afterward.

Deleting the current project selects another. Deleting the last returns to **Add project**, including after restart with the same optional directory argument. See [Data and maintenance](/docs/storage) before cleanup.
