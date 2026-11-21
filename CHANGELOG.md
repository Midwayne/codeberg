# Changelog

Notable changes to Codeberg. Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Notes before 1.0.0
are in the git history.

## [Unreleased]

### Added

- Set `tier: light` on a model in `models.yml` to give a smaller model shorter instructions, fewer tools, and a reminder of the evidence rules.
- Set `tool_batch`, `tool_output_limit`, and `instructions` on a model in `models.yml`.

### Changed

- Shorter, clearer agent instructions, so each chat step sends fewer tokens.
- Database query rules are sent only when a database server is connected.
- Adding an MCP server or skill no longer resets cached instructions for Anthropic models.
- The agent already knows the project's repositories, so it no longer spends a step listing them.
- Long chats clear stale tool output before summarizing older messages, so summaries happen later.

## [1.0.0] - 2026-11-21

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
- Projects find the repositories inside their directory and index each one on its own, so traces can follow calls between them.
- Repositories added to a project directory are picked up the next time Codeberg starts.
- The agent can split independent checks, such as health, metrics, and logs for several services, across parallel subagents. Read-only explorers are the default, and the agent can ask a subagent follow-up questions.
- The chat shows each subagent as it works: its status, current step, the tool it is calling, and its report.
- **Models → Subagents** turns subagents on or off and picks the model they run on.
- Python scripts can call loaded MCP tools that are read-only, or every loaded tool from servers listed in `CODEBERG_SCRIPT_MCP`.

### Changed

- Prebuilt packages no longer include ONNX support, so the Jina ONNX embedding model needs a source installation. The default EmbeddingGemma models are unaffected.
- Adding a directory that is already a project opens that project instead.
- Files in a repository inside a project are indexed once, under that repository.

### Fixed

- Switching chats no longer takes 10 seconds or more.
- `CODEBERG_SCRIPT_USE` and `CODEBERG_SCRIPT_PYTHON` saved in the Codeberg config file now turn on the Python script tool.
