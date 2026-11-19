# Changelog

All notable changes to Codeberg are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html): breaking changes
come only in major releases.

Each released section is shown to users in the app's **What's new** window, so
write entries about what people can now do, not how it was built. Releases
before 1.0 are summarized in 1.0.0; their detailed notes remain in the git
history and on the GitHub releases page.

## [Unreleased]

## [1.0.0] - 2026-11-19

Codeberg 1.0 is the first stable release: a local agent that answers questions
about your code with cited sources from an index it keeps up to date.

### Ask about your code

- Add repositories as **projects** in the browser. Each one gets its own index,
  chats, knowledge, and extensions.
- Indexing splits source into meaningful chunks for Go, TypeScript, JavaScript,
  Python, Java, Kotlin, C, Rust, and Ruby, plus Markdown, YAML, TOML, and JSON,
  and updates as files change.
- Optional local semantic search runs an embedding model on your machine. Start
  with `codeberg --no-vector` to use file, text, symbol, and graph search only.
- Answers cite the files and lines they rely on, and the agent follows imports
  across indexed repositories.

### Work in chats

- Chats are saved and resumable. Branch any chat from a message to try a
  different direction without changing the original.
- Schedule follow-ups and run long tools in the background. Scheduled work is
  visible and can be cancelled from any chat in the project.
- Jump between your earlier prompts with the message rail. Turn on
  **Settings → Canvas** to let the agent draw diagrams you can edit.

### Connect models and tools

- Use OpenAI, Anthropic, Google, Ollama, or llama.cpp models, and pick separate
  models for chat, learning, and summaries under **Models**.
- Connect MCP servers for one project or all projects, add reusable
  **skills**, and optionally enable the built-in MongoDB, PostgreSQL, and Redis
  tools.
- Opt-in tools let the agent write Python scripts that chain read-only tool
  calls (`CODEBERG_SCRIPT_USE=true`) and complete website tasks with
  **Browser Use**.

### Get better with use

- **Knowledge** saves source-backed findings so later answers improve.
- **Learning** collects reviewed examples for custom model training, and
  **Evaluations** compares models on held-out examples.

### New in this release

- A **What's new** window opens once after each update, and the docs list
  every release.
- Animated first-run screens. Both respect reduced-motion settings.
- Switching between chats is fast again; it could take 10 seconds or more.
