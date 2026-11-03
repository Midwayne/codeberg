Indexing runs locally in the background and updates as files change. Chat and embedding models are configured separately.

## Search modes

| Mode | Available tools | Requirements |
| --- | --- | --- |
| Without embeddings | Exact text search, file reads, symbols, outlines, and graph navigation. | `codeberg --no-vector`, or save `CODEBERG_VECTOR=false`. |
| Semantic | Vector similarity alongside lexical and file tools. | Embedding model, runtime, and a compatible index. |

A **chunk** is a source piece with a path and line range. An **embedding** represents it numerically; the **vector index** stores embeddings for similarity search.

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

## Read indexing progress

The startup project begins indexing on launch. Other indexers start on first use and keep watching until shutdown.

| Status | Meaning |
| --- | --- |
| **Counting chunks** | Parsing has not determined the total yet. |
| Chunk counts, such as **1,500 / 2,600** | Measured stored chunks, including cached and duplicate bodies. |
| **Building graph** or file counts | Graph work for the current repository/stage. |
| **Finalizing search** | Remaining graph resolution and persistence. |

The bottom-left panel can be minimized. Counts describe each stage, rather than an estimated percentage for the whole project. They may pause during embedding batches. Cold indexing on large trees or CPUs can take several minutes.

Status checks allow up to 20 seconds for a response. One temporary connection failure keeps the last reported progress and checks again automatically. Repeated failures show a warning that the progress may be out of date; checking continues and clears the warning when the connection recovers. This applies during startup and watched updates.

Chat, grep, file reads, and directory tools work immediately. When embeddings are enabled, hybrid search can use lexical fallback during indexing; index-only tools report that preparation is in progress. Watched updates retain the last completed readiness and expose indexing activity.

If the directory disappears or the indexer stays unreachable, inspect `projects/<id>/logs/indexer.log`, fix the dependency or path, then **Retry**. A long embedding batch alone does not need Retry. See [Troubleshooting](/docs/troubleshooting#indexing-stays-pending-or-fails).

## Memory and storage

Idle embedding models unload after **300 seconds** to release memory. Saved vectors, graph, and file watching stay available. The next semantic query or embedding update reloads the model and may be slower; lexical search needs no reload.

Export `CBERG_EMBED_IDLE_SECONDS=0` to keep models resident, or choose `1`–`86400` seconds. See [Environment variables](/docs/environment).

Project indexes use local `usearch` by default. Remote alternatives are `qdrant` with `CBERG_VECTORDB_URL`, or `pgvector` with `CBERG_POSTGRES_URL`. They require a reachable service, local sidecars, and embeddings; vector data leaves your machine.

Deleting only indexes preserves chats and knowledge. Re-adding the same source root rebuilds search data. See [Data and maintenance](/docs/storage).
