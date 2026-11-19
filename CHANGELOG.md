# Changelog

Notable changes to Codeberg. Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Notes before 1.0.0
are in the git history.

## [Unreleased]

### Changed

- Adding a directory that is already a project opens that project instead.

## [1.0.0] - 2026-11-19

### Added

- Projects: each project is a directory with its own index, chats, knowledge, and
  extensions. It can hold several repositories.
- Indexing for Go, TypeScript, JavaScript, Python, Java, Kotlin, C, Rust, Ruby,
  Markdown, YAML, TOML, and JSON. The index updates as files change.
- Optional local semantic search. `codeberg --no-vector` turns it off.
- Answers cite file and line sources.
- Saved chats, chat branching, scheduled follow-ups, and background tools.
- Models from OpenAI, Anthropic, Google, Ollama, and llama.cpp.
- MCP servers, skills, and optional MongoDB, PostgreSQL, and Redis tools.
- Optional tools: Python scripts (`CODEBERG_SCRIPT_USE=true`), Browser Use, and canvas.
- Knowledge, Learning, and Evaluations.
- **What's new** window after each update.
- Animated first-run screens.

### Fixed

- Switching chats no longer takes 10 seconds or more.
