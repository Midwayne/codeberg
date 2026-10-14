Indexing makes your source tree searchable. It runs locally in the indexer process supervised by the daemon. The browser's project status shows whether that project's index is ready.

## From files to evidence

1. **Read and parse:** Codeberg walks the source tree and uses language-aware parsing where supported.
2. **Chunk:** It splits files into semantic pieces, such as functions and declarations. Each piece retains its source path and line range.
3. **Embed, when enabled:** An embedding model converts chunks into vectors that can be compared to your question.
4. **Search:** The agent combines available search methods and reads the relevant source before forming an answer.
5. **Watch:** File changes update the index incrementally, rather than rebuilding every unchanged file each time.

A **chunk** is a searchable piece of source. An **embedding** is its numeric representation. The **vector index** stores those representations for similarity search. A **chat model** uses retrieved evidence to write an answer; it is a separate model and configuration.

## Choose lexical or semantic search

Start with `codeberg --no-vector`, or save `CODEBERG_VECTOR=false`, for chunk-only operation. Exact text search, file reads, and source navigation still work. Semantic vector search requires an embedding model and its runtime.

The launcher offers an embedding choice before a first download. **EmbeddingGemma 2** is the default for new installs, including unattended launches: `embeddinggemma-2-fp32-mlx` on Apple Silicon, or `embeddinggemma-2` with Sentence Transformers elsewhere. Both use only the text encoder in FP32. Existing configured models and Jina installations keep their model and index. Jina with ONNX and all Qwen variants with MLX on Apple Silicon or llama.cpp remain available. Embedding weights and runtime are separate from your cloud chat provider's API key.

Choose a model for one launch with `codeberg --embedding embeddinggemma-2`, or save it with `codeberg config set CODEBERG_EMBEDDING_MODEL=embeddinggemma-2`. Use `--embedding jina-onnx` to select Jina, or a Qwen ID such as `qwen3-fp16-mlx` or `qwen3-fp16-llama`. The launcher's prompt lists all choices. Stop the launcher before switching models, then restart. Each model gets its own index and sidecars; switching triggers a first index build without deleting previous indexes. Switching back reuses that model's cache.

On Apple Silicon, select the native MLX option with `codeberg --embedding embeddinggemma-2-fp32-mlx`, or save `CODEBERG_EMBEDDING_MODEL=embeddinggemma-2-fp32-mlx`. It runs through MLX-VLM in the separate `CODEBERG_HOME/embeddinggemma-mlx-venv` runtime. Setup converts Google's original weights to unquantized FP32 and saves only the text model. Its model directory and index are separate from the Sentence Transformers option and Qwen's MLX runtime. An existing saved `embeddinggemma-2` choice remains on Sentence Transformers until you switch explicitly.

Both options require **Python 3.10 or newer** with venv and pip support. Initial setup needs network access and several GB of free disk space for dependencies, downloaded weights, and the saved model. Subsequent inference uses local files.

For `embeddinggemma-2`, the launcher installs Sentence Transformers and PyTorch in `CODEBERG_HOME/embeddinggemma-venv`, downloads Google's checkpoint from Hugging Face, and saves a text-only model under `CODEBERG_HOME/models/embeddinggemma-2`.

Both EmbeddingGemma options use its 270M text encoder for code and text search, with 768-dimensional normalized vectors, an 8,192-token input limit including prompts, and distinct code-query and document prompts. Longer inputs are truncated. Setup and inference use **FP32**: MLX on Apple Silicon, or Sentence Transformers on CPU/CUDA. Vision and audio encoders are disabled; image, audio, and video indexing are not exposed. FP16 is incompatible with this model. See [Google's model card](https://huggingface.co/google/embeddinggemma-2) for the model and its requirements.

EmbeddingGemma 2 does not need ONNX or `llama-server`. Jina requires ONNX Runtime; Qwen MLX uses its separate managed Python environment; Qwen llama.cpp needs `llama-server`. Downloads and cold indexing can take time.

## Understand readiness

The startup project's indexer begins on launch. Other project indexers start when first used. Indexers remain running until Codeberg stops so each active project can keep watching its source files.

While indexing, saved chats remain readable and you can draft a question. Sending and regenerating wait for readiness. The count represents chunks currently available, not a percentage of a known total. A large initial embedding run can take several minutes; subsequent launches reuse persisted caches where possible.

EmbeddingGemma cold indexing can take longer on large trees or CPU runtimes. A responding project stays in the indexing state until that pass finishes, even if it exceeds the usual startup wait. Status checks run independently of embedding and search requests. During a watched update, the project retains its last completed readiness; searches may wait for the update to finish. Chunk counts update after parsing and can stay unchanged while a batch is being embedded.

If the directory disappears or the indexer remains unreachable past the startup wait, the UI reports an error. Restore the directory, inspect the project's `logs/indexer.log`, correct the runtime or configuration, and use **Retry**. Repeated process crashes need the underlying error fixed; Retry does not install a missing library. A long embedding batch alone does not require Retry. The launcher's daemon startup wait is separate: set `CODEBERG_HEALTH_TIMEOUT=30m` (or a longer Go duration) if model loading or an unreachable indexer causes launcher startup to time out.

## Know where indexes live

Each project uses its own local index directory and vector namespace under Codeberg home. The default backend is `usearch`. Advanced deployments can configure `CBERG_INDEX_BACKEND=qdrant` with `CBERG_VECTORDB_URL`, or `pgvector` with `CBERG_POSTGRES_URL`. Remote backends require their service to be configured and reachable; they store vector data outside your machine.

Deleting only indexed files leaves saved knowledge and chats intact. Re-adding the same source root rebuilds search data. See [Projects](/docs/projects) and [Data and maintenance](/docs/storage) before removing a project's full history.
