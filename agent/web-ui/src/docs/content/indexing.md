Indexing runs locally in the background and updates as files change. Chat and embedding models are configured separately.

## Search modes

| Mode | Available tools | Requirements |
| --- | --- | --- |
| Without embeddings | Exact text search, file reads, symbols, outlines, and graph navigation. | `codeberg --no-vector`, or save `CODEBERG_VECTOR=false`. |
| Semantic | Vector similarity alongside lexical and file tools. | Embedding model, runtime, and a compatible index. |

A **chunk** is a source piece with a path and line range. An **embedding** represents it numerically; the **vector index** stores embeddings for similarity search.

## How semantic search ranks results

`search_code` and `hybrid_search` rank by meaning first, then by the query's exact code terms:

1. Up to 64 chunks with the most similar embeddings are retrieved.
2. Each one's code is scored for the query's words, with identifiers split at camelCase and snake_case boundaries (`retryWithBackoff` matches "retry backoff").
3. Results are ordered by 70% similarity and 30% keyword match, so a chunk using your exact terms can move ahead of a slightly closer one that does not.

The reported `score` and the `min_score` filter remain semantic similarity. Keyword matching only reorders chunks already among the 64 most similar. To find an exact identifier anywhere, use `grep` or `find_symbol`. This ranking is always on and has no settings.

## Start without an embedding model

Skip embedding selection, downloads, and model workers for one launch:

```sh
codeberg --no-vector
```

To make this the default, save the setting and restart:

```sh
codeberg config set CODEBERG_VECTOR=false
codeberg
```

This mode omits `search_code`, `hybrid_search`, and the experimental `search_bundle` from the agent's tools. The daemon also omits its semantic `search` tool. Use `grep`, `glob`, and `read_file` for discovery; symbol lookup, outlines, chunks, and graph tools become available as background parsing completes. Adding and switching projects uses the same mode.

The UI hides routine project indexing progress in this mode. Parsing, graph construction, and file watching continue in the background. Actual project failures still show a status error with **Retry**.

Chat still needs a configured chat model to answer questions. The app and setup docs open without one. Existing embedding downloads and vector indexes are retained. To restore semantic search, restart with `codeberg --vector`, or save `CODEBERG_VECTOR=true` and restart; normal embedding setup then applies.

For Jina ONNX in a source installation, the launcher checks whether the existing indexer supports ONNX and rebuilds it when needed. On macOS it can install ONNX Runtime through Homebrew. On Linux, install the runtime and export `ONNXRUNTIME_ROOT` to its installation prefix before restarting. If ONNX remains unavailable after rebuilding, normal startup continues without semantic search and prints recovery steps; `codeberg build --vector --embedding jina-onnx` reports the failure.

Embedding prerequisites are skipped, including Python model setup and the source launcher's ONNX dependency check. Optional web search and MCP servers keep their own runtime requirements. Chat provider usage and enabled external tools can still incur costs.

## Follow callers and references

The graph tracks calls, imports, inheritance, and type membership without an embedding model. Its source languages are Go, TypeScript, JavaScript, C, Python, Java, Kotlin, Rust, and Ruby. Markdown, YAML, TOML, and JSON have searchable chunks but no code graph.

Go, TypeScript, and JavaScript calls use local scope and known receiver types; named import aliases and namespace imports constrain targets to the imported file or package. C and Python also check local function scopes and plain parameters. A nearer local function hides an outer parameter, and a local class takes precedence over a same-name import for instance and static calls. Java, Kotlin, Rust, and Ruby retain name-based receiver matching, which can return several same-name methods. Relative imports resolve from the importing file, including directory entrypoints and `.js` specifiers that refer to TypeScript source.

Ask “Who calls this function?” or “Where is this symbol used?” The agent can use `trace_path` for caller/callee traversal and `find_references` for graph edges plus additional exact-name text matches. Callbacks and type-name uses can contribute graph references in Go, TypeScript, and JavaScript. Lexical reference search works across all indexed source languages.

Results are partial. Unknown receivers, function-value aliases, default imports, re-exports, dynamic dispatch, and complex type relationships may remain unresolved. Go package matching uses directories, and implicit import names assume the final path segment. Inheritance lookup for method calls handles same-file class chains up to eight levels. This is syntactic analysis; graph confidence is a heuristic, not a measured probability. Text matches can include declarations and comments. See [Reference tools](/docs/tools#inspect-symbol-usage) for limits and filters.

After upgrading the graph format, the first launch rebuilds the graph from source. Later launches reuse the new cache. Embedding setup is not required for this rebuild.

## Follow dependencies across repositories

Select the repositories together in one workspace:

```sh
codeberg --root "$HOME/projects/api,$HOME/projects/storage" --no-vector
```

Registered selections also work with `--repos api,storage` or `--all`. Separately selected browser projects keep separate indexers; opening two projects does not automatically join their graphs. See [Projects](/docs/projects).

Unscoped graph search, references, hubs, and architecture inspect all configured roots. Set `repo` to choose a starting symbol's repository. Incoming callers and outgoing traces can then cross an import into another configured root. Ambiguous trace names spanning several repos require `repo`; the tool does not choose an arbitrary repository.

| Language | Cross-root import evidence |
| --- | --- |
| Go | Root `go.mod` module path and package directory. |
| TypeScript / JavaScript | Relative source paths, or root `package.json` name and a resolvable `exports`, `module`, `main`, or `types` entry. Available implementation entries take precedence over declaration files; missing entries are skipped. Exact subpath exports are supported; blocked exports, export patterns, and complex conditions can remain unresolved. |
| C | Explicit include path to indexed source/header definitions. This does not replace compiler/linker analysis of declarations and implementations. |
| Python | Dotted module matching a `.py` or `__init__.py` under a configured root or its `src` directory. Runtime `sys.path` changes and import aliases are not inferred across roots. |
| Java / Kotlin | Declared package plus a uniquely indexed named type/function. |
| Rust | Root `Cargo.toml` package name, default `src/lib.rs` or conventional module files, and a simple `use` path. Renamed dependencies, grouped uses, re-exports, and explicit `[lib]` configurations can remain unresolved. |
| Ruby | Explicit relative `require` path to an indexed file. Dynamic load paths remain unresolved. |

Same-name symbols alone do not link unrelated roots. Ambiguous cross-root providers stay unresolved. Results carry source and destination repository keys; IDs and relative paths must be interpreted with their repo. Cross-root method resolution still has the language limits above and is not a compiler-derived dependency graph.

The combined graph is a cached query view over the per-repo indexes. It uses extra memory, builds on the first structural query, and refreshes after graph updates or supported manifest changes. Per-repo sidecars remain reusable. Only configured roots participate; external packages and service/RPC relationships are not inferred.

## Choose an embedding model

New installs default to **EmbeddingGemma 2**, text encoder only, in FP32. Existing choices and Jina installations are retained.

| Selection | Runtime | Requirements |
| --- | --- | --- |
| `embeddinggemma-2-fp32-mlx` | MLX-VLM; default on Apple Silicon. | Apple Silicon, Python 3.10+ with venv/pip. |
| `embeddinggemma-2` | Sentence Transformers/PyTorch; default elsewhere. | Python 3.10+ with venv/pip; CPU/CUDA. |
| `jina-onnx` | ONNX Runtime. | Runtime bundled with prebuilt packages; no Python. |
| Qwen variants | MLX or llama.cpp. | Separate managed Python runtime for MLX, or `llama-server`. |

Choose for one launch, or save a default:

```sh
codeberg --embedding embeddinggemma-2
codeberg config set CODEBERG_EMBEDDING_MODEL=embeddinggemma-2
```

Other IDs include `qwen3-fp16-mlx` and `qwen3-fp16-llama`; the launcher lists all choices. Stop Codeberg before switching, then restart. Each model has separate indexes and sidecars. First use builds its index; switching back reuses its cache.

## EmbeddingGemma setup

First setup needs network access and several GB of space for dependencies and weights. Later inference uses local files. EmbeddingGemma needs neither ONNX nor `llama-server`.

| Selection | Managed runtime under Codeberg home |
| --- | --- |
| Sentence Transformers | `embeddinggemma-venv`; text model in `models/embeddinggemma-2`. |
| MLX | `embeddinggemma-mlx-venv`; separate converted FP32 text model. |

An existing saved `embeddinggemma-2` choice stays on Sentence Transformers until explicitly changed. MLX setup converts Google's original weights and saves only the text model.

Both use the 270M text encoder, 768-dimensional normalized vectors, and an 8,192-token input limit including prompts. Longer inputs are truncated. Code queries and documents use distinct prompts. FP16 is incompatible; image, audio, and video indexing are unavailable. See [Google's model card](https://huggingface.co/google/embeddinggemma-2).

## Jina input limit

Jina ONNX embeds the first **512 tokens** of each chunk, about 2 KB of code; the rest of a longer chunk does not affect its vector. Before November 2026 the limit was 256 tokens.

An index built with the old limit keeps its 256-token vectors for unchanged chunks; new and edited chunks use 512. To re-embed everything, delete the project's indexed files and add the project again (see [Data and maintenance](/docs/storage#free-up-space)). A full embedding pass took about 20% longer than with 256 tokens on Codeberg's own source; repositories with many long functions take longer.

## Read indexing progress

The startup project begins indexing on launch. Other indexers start on first use and keep watching until shutdown.

| Status | Meaning |
| --- | --- |
| **Scanning files**, such as **1,234 files scanned** | Files are being read and parsed; the chunk total is not known yet. |
| Chunk counts, such as **1,500 / 2,600** | Measured stored chunks, including cached and duplicate bodies. |
| **Building graph** or file counts | Graph work for the current repository/stage. |
| **Finalizing search** | Remaining graph resolution and persistence. |

The bottom-left panel can be minimized. Counts describe each stage, rather than an estimated percentage for the whole project. They may pause during embedding batches. Cold indexing on large trees or CPUs can take several minutes.

Status checks allow up to 20 seconds for a response. One temporary connection failure keeps the last reported progress and checks again automatically. Repeated failures show a warning that the progress may be out of date; checking continues and clears the warning when the connection recovers. This applies during startup and watched updates.

Chat, grep, file reads, and directory tools work immediately. When embeddings are enabled, hybrid search can use lexical fallback during indexing; index-only tools report that preparation is in progress. Watched updates retain the last completed readiness and expose indexing activity.

If the indexer stops three times in a row, the panel shows the reason it gave and the log path. Codeberg keeps restarting it with a growing delay of up to 30 seconds. **Retry** restarts a stopped indexer immediately, and replaces one that never started answering.

If the directory disappears or the indexer stays unreachable, inspect `projects/<id>/logs/indexer.log`, fix the dependency or path, then **Retry**. A long embedding batch alone does not need Retry. See [Troubleshooting](/docs/troubleshooting#indexing-stays-pending-or-fails).

## What gets indexed

Indexing covers recognized source, Markdown, and config files under each project directory. Some content is left out so one large file cannot dominate indexing time or search results.

| Content | Behavior |
| --- | --- |
| `.git`, `node_modules`, `vendor`, `.venv`, `__pycache__`, `.next`, `dist`, `build`, `target`, `.gradle`, `.idea`, `.terraform` | Directories with these names are skipped. |
| Files larger than **1 MB** | Not chunked or embedded. Typical cases are generated parsers, bundles, and data dumps. |
| JSON, YAML, or TOML with more than **256** top-level entries | Indexed in 50-line windows instead of one chunk per key. |
| Files or folders Codeberg cannot read | Skipped; the rest of the project is still indexed. |
| Unrecognized file types | Not read. |

Skipped files are listed in `projects/<id>/logs/indexer.log` (the first 20, then every 1,000th). Grep, file reads, and directory tools still reach files that the index leaves out, except inside the skipped directories.

To change the size limit, set `CBERG_MAX_FILE_BYTES` (bytes; `0` removes the limit) before starting Codeberg, then delete the project index and re-add the project to rebuild. See [Environment](/docs/environment).

Vendored code in other directories, such as git submodules under `third_party`, is indexed like your own code and can lengthen a cold index considerably.

## Memory and storage

Idle embedding models unload after **300 seconds** to release memory. Saved vectors, graph, and file watching stay available. The next semantic query or embedding update reloads the model and may be slower; lexical search needs no reload.

Export `CBERG_EMBED_IDLE_SECONDS=0` to keep models resident, or choose `1`–`86400` seconds. See [Environment variables](/docs/environment).

Project indexes use local `usearch` by default. Remote alternatives are `qdrant` with `CBERG_VECTORDB_URL`, or `pgvector` with `CBERG_POSTGRES_URL`. They require a reachable service, local sidecars, and embeddings; vector data leaves your machine.

Deleting only indexes preserves chats and knowledge. Re-adding the same source root rebuilds search data. See [Data and maintenance](/docs/storage).
