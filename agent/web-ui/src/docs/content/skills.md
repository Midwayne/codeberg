A skill is a reusable instruction document. It tells the agent how to approach a task, such as reviewing a change, explaining an architecture, or following your team's conventions. A skill supplies guidance; an MCP server supplies callable tools.

## Write a skill in the app

Open **Settings → Skills** and choose the current project or **All projects**. Enter a name, description, and instructions, then choose **Add skill**. The name uses letters, numbers, dashes, or underscores, and must be unique in that storage scope.

Give the description a clear trigger: when should the agent use this skill? In the instructions, describe the task, required checks, expected output, and boundaries. Specific instructions are easier to apply than a long list of broad preferences.

## Import an existing document

Use **Choose skill files** or drop Markdown files onto **Import skill files**. Review the preview, then choose **Import**. You can import up to 20 UTF-8 `.md` files, with a 256 KB limit per file. Invalid files report individual errors; existing skills are not overwritten.

A reusable `SKILL.md` needs a name and description in YAML frontmatter:

```md
---
name: review-api-change
description: Use when reviewing changes to HTTP endpoints.
---

# Review an API change

Check request validation, status codes, compatibility, and tests.
Explain the concrete impact of each issue and cite the relevant source.
```

For imported files with another filename, the preview can derive the name from that filename. Confirm the result before importing. If only some imports succeed, the failed files remain available for review or retry.

## Understand discovery and scope

Global skills are discovered in `~/.agents/skills`, `~/.cursor/skills`, and the Codeberg home's `skills/`. Repository skills can live in `.agents/skills`, `.cursor/skills`, or `.codeberg/skills`. Skills added for one project live under `projects/<id>/skills/` in Codeberg home.

Later roots override a skill with the same name; the selected project's storage is checked after repository and global locations. You can inspect effective skills and their scope in Settings. Changes apply on a subsequent chat turn, while an existing stream retains its current tools and context.

## Use a skill in a question

Mention the skill name or describe the task covered by its description. The agent sees the skill catalog and can read the full instructions when relevant. For example: “Use review-api-change to review this endpoint.”

Skills do not install missing executables, create a provider connection, or add a database integration by themselves. Configure [models](/docs/models) and [MCP servers](/docs/mcps) separately when a workflow needs them.
