A project connects a repository directory to its own search index, chats, knowledge, and extensions. It gives the agent a clear source tree to investigate and keeps the history of unrelated repositories separate.

## Add and select a project

Choose **Add project** and select an existing directory on the machine running Codeberg. You can use the native folder picker or enter an absolute path. On Linux, the picker needs `zenity` or `kdialog` and a desktop session; manual entry works when a dialog cannot open.

The project selector in the chat sidebar controls the current browser tab. On phones, open the sidebar to find it. Selection is saved in that tab and its `?project=` URL; another tab can investigate a different project. Switching projects keeps live responses and queued follow-ups running in their original chats. Returning to a project restores its selected chat and current progress; completed responses are saved there.

With no startup root, Codeberg restores saved projects or shows **Add a project to get started**. Use `codeberg /absolute/repository`, `--root`, or `CODEBERG_ROOT` only when you want an explicit startup project. The directory containing Codeberg itself is not automatically your project.

## What belongs to a project

- Source roots, file watching, and search index namespaces.
- Chats, branches, chat search, and feedback.
- Saved knowledge, learning history, and datasets.
- Project-specific MCP configuration, skills, and database specs.

Model choices, provider credentials, global extensions, and usage accounting belong to Codeberg home and are shared. Browser appearance is stored in that browser.

Each project has a stable ID derived from its canonical source path. Adding a symlink to the same directory does not create a separate project. Renaming the display label keeps the ID and history. Moving a repository to another path changes its identity; do not move catalog files by hand to merge histories.

## Inspect or rename

Open **Settings → Projects**. The list shows the repository paths, stable ID, config directory, and current selection. Copy controls help you find files. Choose **Rename**, change the display label, then **Save name**; Cancel leaves the original label.

An older multi-repository startup configuration remains a single **Existing workspace** project. Its repository keys and combined search behavior are preserved. New projects added through the browser are independent.

## Delete with the right scope

**Delete indexed files only** removes the project from the catalog and deletes its search indexes, while retaining chats, history, knowledge, and configuration. Re-adding the same directory reuses that data and rebuilds the index.

**Delete entire history, including knowledge** removes the project's indexes and saved project data. Re-adding then starts with fresh data. Both options leave your source directory and source files on disk.

Active requests and background learning must finish before deletion. A busy error can be retried. Deleting the current project selects another one; deleting the last shows Add project. See [Data and maintenance](/docs/storage) for cleanup and backup guidance.
