## Add a project

A project is a directory, such as one team's folder. It can hold one repository or several.

1. Run `codeberg`, then choose **Add project**.
2. Select an existing directory on the Codeberg host with **Choose folder**, or enter an absolute path. On Linux, the picker needs `zenity` or `kdialog` and a desktop session; manual entry works without them.
3. Choose **Add project**. Codeberg finds the repositories inside the directory and indexes each one on its own; there is nothing to configure.

```text
team-a/            project directory: README, docs, and other loose files
├── api/           repository (.git)
├── storage/       repository (go.mod)
└── docs/          part of team-a
```

## Repositories in a project

Codeberg indexes each repository on its own, so imports resolve inside each one and traces can follow calls from one repository into another. Files outside any repository stay searchable under the project directory. Each file is indexed once, under the innermost folder that holds it.

| A folder becomes a repository when it has | Examples |
| --- | --- |
| Version control | `.git` |
| A build manifest | `go.mod`, `package.json`, `Cargo.toml`, `pyproject.toml`, `setup.py`, `pom.xml`, `build.gradle`, `Gemfile`, `CMakeLists.txt` |

Codeberg looks up to three folders deep and does not split a repository it has found, so a monorepo's own packages stay together. Hidden folders and dependency folders such as `node_modules` are skipped. A directory that is itself a repository is indexed as one.

Codeberg looks again each time it starts, so a repository cloned into the directory is picked up after the next restart, and a removed one is dropped. Projects added before Codeberg found repositories are split the same way on their next start; their repositories are indexed once, and chats and knowledge stay with the project. **Settings → Projects** lists the project directory and the repositories found.

Each repository's MCP servers and skills are loaded alongside the project directory's.

### Repository notes for the agent

If a repository has an instruction file for coding agents at its root, the agent reads it at the start of each turn and uses it for layout, terminology, and commands. Codeberg checks these files in order and uses the first one that is not empty:

| Order | File |
| --- | --- |
| 1 | `AGENTS.md` |
| 2 | `CLAUDE.md` |
| 3 | `GEMINI.md` |
| 4 | `.github/copilot-instructions.md` |
| 5 | `.cursorrules` |

| Limit | Value |
| --- | --- |
| Repositories read | First 8 in the project |
| Text per repository | About 3,000 characters; the agent reads the rest of the file when it needs it |
| Text per turn | About 12,000 characters |

Notes add to the text sent with each chat step. They describe the repository only: they cannot override your request or Codeberg's rules, and they never authorize running tools or changing data.

Each directory belongs to one project. Adding a directory that is already a project opens that project instead of creating a second one. Directories inside another project's directory can be their own projects; each project keeps its own index, chats, and knowledge.

Projects return on later launches. With no projects, the daemon stays idle and the app shows **Add a project to get started**. Codeberg's own directory is not automatically added.

For an explicit startup project:

```sh
codeberg /absolute/project-dir
# Or: codeberg --root /absolute/project-dir
```

A startup project indexes exactly the directories you name, without looking for repositories inside. To have Codeberg find them, add the directory with **Add project** instead.

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

IDs follow the canonical source path. Symlinks to the same directory share a project. Renaming its display label keeps history; moving the directory changes its identity. Do not merge histories by moving catalog files.

Older multi-repository startup configurations remain one **Existing workspace**, preserving their repository keys and combined search.

Repositories in the same project share one graph: structural search and references inspect all of them, and import-backed edges can cross between them. Repository keys distinguish identical file paths and symbol IDs. The agent's instructions list the project's repository keys, read when the agent starts for a model. When you add a repository later, the agent finds it with the `repos` tool. Separate projects stay isolated. See [Cross-repo graph setup and limits](/docs/indexing#follow-dependencies-across-repositories).

## Inspect or rename

Open **Settings → Projects** to see the project directory, its repositories, IDs, config directories, and current selection. Use the copy controls to locate files.

Choose **Rename**, edit the label, then **Save name**. **Cancel** keeps the original label.

## Delete a project

Choose **Settings → Projects → Delete project**.

| Option | Result when the same directory is added again |
| --- | --- |
| **Delete indexed files only** | Reuses retained chats, history, knowledge, and configuration; rebuilds search indexes. |
| **Delete entire history, including knowledge** | Starts fresh; saved project data is permanently removed. |

Both remove the catalog entry and leave source files on disk. Wait for active requests and background learning before deleting; retry a busy error afterward.

Deleting the current project selects another. Deleting the last returns to **Add project**, including after restart with the same optional directory argument. See [Data and maintenance](/docs/storage) before cleanup.
