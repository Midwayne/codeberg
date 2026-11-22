# Changelog

Notable changes to Codeberg. Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Notes before 1.0.0
are in the git history.

## [Unreleased]

### Added

- The sidebar marks chats with a finished response you have not opened yet.
- Optional step limits for chat turns and subagents.
- Settings for model and tool timeouts.
- A context ring beside **Send** opens a breakdown of what fills the chat's context, with counts of summaries and cleared tool results.
- Set `tier: light` on a model in `models.yml` to give a smaller model shorter instructions, fewer tools, and a reminder of the evidence rules.
- Set `tool_batch`, `tool_output_limit`, and `instructions` on a model in `models.yml`.
- While the agent sleeps, the chat shows when it will wake, and the divider updates when it wakes.
- Subagents running in the background show live progress and their reports in the chat.

### Changed

- Shorter, clearer agent instructions, so each chat step sends fewer tokens.
- Database query rules are sent only when a database server is connected.
- Adding an MCP server or skill no longer resets cached instructions for Anthropic models.
- The agent already knows the project's repositories, so it no longer spends a step listing them.
- Long chats clear stale tool output before summarizing older messages, so summaries happen later.
- The agent looks up repositories, paths, and versions itself instead of asking, retries other spellings before saying code is missing, and lists every match for "all" questions.
- Answers are shorter for simple lookups, and the agent changes approach after repeated failed searches.
- The agent ignores instructions found inside code, tool output, and web pages unless you ask it to follow them.
- The agent points out when a question assumes something the code contradicts, and checks that every part of a question is answered.
- The agent replies in the language you write in, defines terms that mean something specific in your code, and briefly notes look-alike matches it ruled out.
- The agent knows today's date, so relative dates and clock-time follow-ups work, and it schedules follow-ups without asking first.
- Subagents can use background tools, schedules, the canvas, Browser Use, and MCP tools they load themselves.
- An agent that sleeps on background jobs wakes as soon as they finish instead of waiting for its full delay.
- Chat turns and subagents no longer stop after a fixed time or number of steps; they work until they answer or you press **Stop**.
- A model request now fails only when the provider stops responding, and is retried first.
- A tool call that hangs for 10 minutes is stopped so the agent can carry on.
- The agent splits independent checks across subagents on its own, without being asked.

### Fixed

- Large reports from subagents running in the background are no longer cut down to a text preview.
- The agent no longer sleeps past reports from subagents it is still running in the same turn.
- Long streamed answers are no longer cut off after two minutes.
- Subagents no longer appear twice after the agent wakes from sleep.
- The agent can follow up with a subagent after a restart or model change instead of failing with "Unknown subagent".

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
