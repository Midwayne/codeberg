Skills give the agent reusable instructions for tasks such as API review or architecture explanations. [MCP servers](/docs/mcps) separately provide callable tools.

## Write a skill

1. Open **Settings → Skills**.
2. Choose the current project or **All projects**.
3. Enter a name, description, and instructions, then **Add skill**.

Names use letters, numbers, dashes, or underscores and must be unique in that scope. Describe when the skill should run, what to check, expected output, and boundaries.

## Import Markdown

Choose **Choose skill files**, or drop files onto **Import skill files**. Review the preview, then **Import**.

| Limit | Value |
| --- | --- |
| Files | Up to 20 UTF-8 `.md` files. |
| Size | 256 KB per file. |
| Existing names | Not overwritten. |

A reusable `SKILL.md` needs YAML frontmatter:

```md
---
name: review-api-change
description: Use when reviewing changes to HTTP endpoints.
---

# Review an API change

Check request validation, status codes, compatibility, and tests.
Explain each issue's concrete impact and cite the source.
```

Other filenames can supply a derived name in the preview. Invalid files show individual errors; failed files remain available for review or retry after partial success.

## Discovery and scope

Later locations override the same skill name:

| Order | Locations |
| --- | --- |
| Global | `~/.agents/skills`, `~/.cursor/skills`, Codeberg home's `skills/`. |
| Repository | `.agents/skills`, `.cursor/skills`, `.codeberg/skills`. |
| Stored project | `projects/<id>/skills/` in Codeberg home. |

Each location accepts Markdown files or directories containing `SKILL.md`. Inspect effective skills and scopes in Settings. Changes apply to the next chat turn; active streams retain their current context.

## Use a skill

Mention its name or describe a task matching its trigger:

```text
Use review-api-change to review this endpoint.
```

The agent sees the catalog and reads relevant instructions. Skills do not install executables or connect providers/services; configure those separately.
