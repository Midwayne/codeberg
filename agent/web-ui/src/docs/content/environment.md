Environment variables control startup, providers, tools, and indexing. Most users only need a chat model and its credentials. Projects can be added in the app; a startup repository is optional.

## Set a value in the right place

Tables marked **Config or environment** accept both a saved launcher setting and a process environment variable:

```sh
codeberg config set CODEBERG_WEB_PORT=48088
codeberg config get CODEBERG_WEB_PORT
codeberg config unset CODEBERG_WEB_PORT
```

Tables marked **Environment only** must be exported in the shell that starts Codeberg. For example, this sets a context window for one launch:

```sh
CODEBERG_CONTEXT_WINDOW=32768 codeberg
```

> **Restart after changing startup values.** Saving an unknown key in the launcher config does not make it available to a child process. For environment-only settings, export the value before launch. See [Configuration](/docs/configuration) for precedence and editable files.

Use `true` or `false` for switches, plain integers for ports and token counts, and absolute paths for files and directories. Values inside the saved config are literal text; it is not a shell script and does not expand `$VARIABLE` expressions. API keys and connection strings are secrets.

## Home, projects, and startup

**Config or environment**, with one exception: select `CODEBERG_HOME` through the process environment or `--home` so the launcher can find the config file in that home.

| Variable | Value or default | What it changes |
| --- | --- | --- |
| `CODEBERG_HOME` | Directory; normally `~/.codeberg` | Global config, model files, project catalog, and managed data. Set it before launching; moving data is a separate step. |
| `CODEBERG_ALL` | Boolean; `false` | Serve all repositories in the launcher's registry. Cannot combine with an explicit `--root` argument. |
| `CODEBERG_REPOS` | Comma-separated registered keys or directories | Serve a chosen registry subset. Cannot combine with an explicit `--root` argument. |
| `CODEBERG_NO_INDEX` | Boolean; `false` | Skip registry additions and vector indexing for the launch. File tools and chat remain available; this is not a switch for deleting history. |
| `CODEBERG_REPO` | Optional directory | Override the location of Codeberg's own source checkout when automatic discovery fails. This is different from the project you want to index. |
| `CODEBERG_DIST` | Optional prebuilt artifact directory | Run an existing built payload instead of building from a source checkout. This override does not install a release. |

Browser projects and the launcher's repository registry are separate catalogs. **Add project** is the normal browser workflow; `CODEBERG_ALL` and `CODEBERG_REPOS` refer to the registry created by terminal repository runs.

## Chat models and credentials

**Config or environment.** A model selection uses `provider:model`. Provider keys are needed only for the provider you select; the docs open before any model is configured.

| Variable | Value or default | What it changes |
| --- | --- | --- |
| `CODEBERG_MODEL` | Optional `provider:model` | Initial chat model. A usable `models.yml` catalog can supply the available choices instead. |
| `CODEBERG_SUBAGENT_MODEL` | Defaults to the chat model | Initial model for background extraction and learning work. |
| `CODEBERG_REASONING` | Provider default when unset | `provider-default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Actual support depends on the selected provider and model. |
| `OPENAI_API_KEY` | Secret | Credential for the `openai` provider. |
| `ANTHROPIC_API_KEY` | Secret | Credential for the `anthropic` provider. |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Secret | Credential for the `google` provider. |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | OpenAI-compatible chat endpoint for the `ollama` provider. Include `/v1`. |
| `LLAMACPP_BASE_URL` | `http://localhost:8080/v1` | Chat endpoint for a separately running llama.cpp server. Include `/v1`. |

**Environment only:** `OLLAMA_API_KEY` and `LLAMACPP_API_KEY` override the local providers' placeholder keys when your endpoint requires authentication. They are not loaded from the launcher's config file. Local servers normally need no real key.

For catalog syntax, local server setup, and saved model choices, see [Models and credentials](/docs/models).

## Context and tool calling

**Environment only.** Values apply to the agent; the model catalog can also declare per-model context windows.

| Variable | Value or default | What it changes |
| --- | --- | --- |
| `CODEBERG_CONTEXT_WINDOW` | Positive token count; inferred from the model otherwise | Override the model's hard context window. Use the capacity actually loaded by your local server. |
| `CODEBERG_CONTEXT_BUDGET` | Positive token count; `200000` | Working context ceiling, capped by the hard context window. History and pruning budgets use this ceiling. |
| `CODEBERG_TOOL_BATCH` | Boolean; automatic by provider | Enable the `batch` tool for models that struggle to return several tool calls in one response. Local and unknown providers enable it by default. |

## Local services and ports

**Config or environment.** The browser and daemon bind to loopback; setting a port does not expose them to another computer.

| Variable | Value or default | What it changes |
| --- | --- | --- |
| `CODEBERG_WEB_PORT` | Port; `48088` | Browser UI server. |
| `CODEBERG_HTTP_PORT` | Port; `48080` through the launcher | Daemon HTTP API. Running `codeberg-d` directly defaults to `8080`. |
| `CODEBERG_DAEMON_URL` | `http://127.0.0.1:<daemon port>` | Daemon endpoint used by the agent. Useful when running components separately. |
| `CBERG_SOCKET` | Path; `/tmp/codeberg-index.sock` | Indexer IPC socket. Separate daemon instances need separate socket paths. |
| `CBERG_INDEX_BIN` | Optional executable path | Override the `cberg-index` binary. Normally found beside the daemon or on `PATH`. |
| `CBERG_POLL_MS` | Milliseconds; `1000` | Watcher polling interval. Non-positive values fall back to `1000`. |
| `CODEBERG_GIT_PULL_INTERVAL_SEC` | Seconds; disabled when unset or `0` | Periodically pull repositories to refresh mirrors. Enable only when automatic pulls suit the source directories. |
| `CODEBERG_GIT_DIR` | Optional directory | Restrict periodic pulls to one directory; otherwise the served roots are considered. |

## Embeddings and vector storage

**Config or environment** for these launcher settings:

| Variable | Value or default | What it changes |
| --- | --- | --- |
| `CODEBERG_VECTOR` | Boolean; `true` | Set `false` to skip embedding downloads and semantic search. Lexical and file tools still work. |
| `CODEBERG_EMBEDDING_MODEL` | Registry ID; `embeddinggemma-2-fp32-mlx` on Apple Silicon, `embeddinggemma-2` elsewhere | Select an embedding model and backend. Existing selections and Jina installations are retained. The first-run prompt also offers Qwen variants and `jina-onnx`. |
| `CBERG_MODEL` | Optional model path | Custom ONNX model path when no registry selection is set. Otherwise the launcher resolves the selected model. |
| `CBERG_INDEX_PATH` | Index base path; managed under Codeberg home | Base for vector files and sidecars. Registry selections can use their own model-specific paths; project indexes are isolated. |

**Environment only** for storage and performance controls:

| Variable | Value or default | What it changes |
| --- | --- | --- |
| `CBERG_INDEX_BACKEND` | `usearch` | `usearch` for local files, `qdrant` for Qdrant, or `pgvector` for PostgreSQL; `postgres` is an alias. |
| `CBERG_INDEX_QUANT` | `i8` | Scalar kind for newly created usearch indexes: `i8` or `f32`. This does not convert an existing index. |
| `CBERG_VECTORDB_URL` | URL; required for Qdrant | Qdrant endpoint. |
| `CBERG_VECTORDB_API_KEY` | Optional secret | Qdrant authentication. |
| `CBERG_POSTGRES_URL` | Connection string; required for pgvector | PostgreSQL database with the pgvector extension installed. |
| `CBERG_EMBED_THREADS` | Integer; automatic when unset or non-positive | ONNX intra-op thread limit. |
| `CBERG_EMBED_IDLE_SECONDS` | Integer `0`–`86400`; `300` | Unload an idle embedding model after this many seconds. `0` keeps it resident. The next semantic query or embedding update reloads it, adding model-loading latency. Export before startup; environment only. |
| `CBERG_EMBED_BATCH` | Integer `1`–`1024`; `16` | Rows per ONNX inference batch. Larger batches need more memory. |
| `CBERG_EMBED_COREML` | `1` to enable; off by default | Opt into the CoreML execution provider on Apple builds that support it. Unsupported execution falls back to CPU. |
| `CBERG_GRAPH` | On by default; `0`, `off`, or `false` disables | Build the syntactic graph sidecar used for symbol relationships. |
| `CBERG_GRAPH_MODE` | `fast` | Graph extraction mode. Other modes currently fall back to `fast` with a warning. |

Remote vector storage still needs the local sidecars and an embedding model. Changing an embedding model requires compatible indexes; see [Indexing and search](/docs/indexing).

## Web search and URL fetching

**Config or environment** for the main switches:

| Variable | Value or default | What it changes |
| --- | --- | --- |
| `CODEBERG_WEB_USE` | Boolean; `true` | Master switch for web tools. Search also requires its separate opt-in. |
| `CODEBERG_WEB_SEARCH_USE` | Boolean; `false` | Opt into web search. Sets the initial browser preference; a saved Settings → Tools switch takes precedence. Direct URL fetching is independent. |
| `CODEBERG_SEARXNG_URL` | Optional URL | Use an existing SearXNG service when search is enabled. Otherwise the launcher installs and manages a local instance on demand. |
| `CODEBERG_SEARXNG_PORT` | Port; `48089` | Preferred managed SearXNG port; the launcher can choose a free port if occupied. |

**Environment only** for request limits:

| Variable | Value or default | What it changes |
| --- | --- | --- |
| `CODEBERG_WEB_ALLOW_PRIVATE` | Boolean; `false` | Allow `fetch_url` to reach localhost and private network hosts. |
| `CODEBERG_WEB_MAX_BYTES` | Positive integer; `1500000` | Maximum raw response body size. |
| `CODEBERG_WEB_MAX_CHARS` | Positive integer; `20000` | Maximum extracted text length. |
| `CODEBERG_WEB_TIMEOUT_MS` | Milliseconds; `15000` | Web request timeout. |
| `CODEBERG_WEB_SEARCH_COUNT` | Positive integer; `6` | Default number of web search results. |

## MCP servers, databases, and learning

**Config or environment.** These enable optional capabilities; their detailed setup lives in [MCP servers](/docs/mcps), [Knowledge](/docs/knowledge), and [Learning](/docs/learning).

| Variable | Value or default | What it changes |
| --- | --- | --- |
| `CODEBERG_MCP_USE` | Boolean; `true` | Load servers from MCP configuration files. |
| `CODEBERG_MCP_CONFIG` | Comma-separated file paths | Additional `mcp.json` files; later definitions override earlier servers with the same name. |
| `CODEBERG_DBMCP_USE` | Boolean; `false` | Enable the separate built-in database MCP server. Independent of `CODEBERG_MCP_USE`. |
| `CODEBERG_DBMCP_SPEC` | Optional spec path | Override the database connection spec. Newly added projects normally use their own `spec.yml` or `spec.yaml`. |
| `CODEBERG_DBMCP_BIN` | Optional executable path | Override the built-in `dbmcp` binary. |
| `CODEBERG_LEARNING_USE` | Boolean; `true` | Enable learning, history recall, feedback, and background extraction. Disabling it retains existing stored data. |

> **Extension credentials come from the process environment.** For `${env:MCP_TOKEN}` in `mcp.json`, or `${POSTGRES_URI}` in a database spec, export that variable before starting Codeberg. Arbitrary secret names in the saved launcher config are not forwarded automatically.

**Environment only:** `CODEBERG_CANVAS_USE=true` enables the initial canvas capability. The project's canvas setting in the app can subsequently change it.

## Advanced component and developer settings

**Environment only.** Most installations leave these unset. The launcher supplies several of them automatically; use its high-level settings rather than overriding its child-process values.

| Variable | Where it applies | What it changes |
| --- | --- | --- |
| `CODEBERG_HEALTH_TIMEOUT` | Launcher and daemon | Go duration such as `30m` for indexing readiness. The launcher normally waits at least 15 minutes, increasing for many roots. |
| `CODEBERG_SKIP_DEP_INSTALL` | Launcher | Set `1` to check prerequisites without automatically installing missing dependencies. |
| `ONNXRUNTIME_ROOT` | Source build discovery | ONNX Runtime installation directory. A manual CMake build also needs its `-DONNXRUNTIME_ROOT` option. |
| `CODEBERG_WEB_ROOT` | Direct agent server | Override the directory containing the built browser UI. |
| `PORT` | Direct agent server | Fallback web port when `CODEBERG_WEB_PORT` is unset. The launcher supplies the latter. |
| `CODEBERG_QUESTION` | `codeberg-ask` CLI | One-shot question when no command-line question is provided. |
| `CODEBERG_LOG_DIR` | Direct components | Module log directory. The launcher assigns its own home-based log location; selected projects have their own logs. |
| `CODEBERG_ROOTS` | Direct daemon and agent | Newline-separated `key<TAB>absolute-path` records. Normally generated by the launcher or project catalog. |
| `CBERG_EMBED_BACKEND` | Direct daemon/indexer | `onnx`, `mlx` (Qwen), `gemma-mlx`, `llama`, or `sentence-transformers`. The launcher selects this from `CODEBERG_EMBEDDING_MODEL`. |
| `CBERG_EMBED_WORKER` | Direct non-ONNX indexer | Python worker script. The launcher supplies its bundled worker. |
| `CBERG_EMBED_PYTHON` | Direct non-ONNX indexer | Python executable for that worker. The launcher supplies its separate MLX or EmbeddingGemma environment when applicable. |
| `CBERG_LLAMA_SERVER` | llama.cpp embedding worker | Override the `llama-server` executable. This is separate from `LLAMACPP_BASE_URL` for chat. |
| `EDITOR`, `VISUAL` | Launcher config editor | Editor command for `codeberg config edit`; `VISUAL` wins, then `EDITOR`, then `vi`. |

`CODEBERG_PROJECT_ID`, `CODEBERG_PROJECT_HOME`, `CODEBERG_RESOURCE_ROOT_PID`, `CODEBERG_PICKER_START`, and `CODEBERG_CONFIG_DIRECTORY` are runtime plumbing supplied by the app. Use the project selector and Settings to manage these values instead of adding them to your config.
