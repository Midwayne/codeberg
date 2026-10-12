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

The launcher offers an embedding choice before a first download. Existing configured models and indexes are reused. Available selections include Jina with ONNX, and Qwen embedding variants with MLX on Apple Silicon or llama.cpp. The weights and runtime are separate from your cloud chat provider's API key.

You can choose a supported model explicitly, for example `codeberg --embedding jina-onnx`. Use `codeberg --help` and the launcher's embedding prompt for the available choices. ONNX requires its runtime library; MLX uses a managed Python environment; llama.cpp needs `llama-server`. Downloads and cold indexing can take time. Stop the launcher before changing runtime configuration, then restart.

## Understand readiness

The startup project's indexer begins on launch. Other project indexers start when first used. Indexers remain running until Codeberg stops so each active project can keep watching its source files.

While indexing, saved chats remain readable and you can draft a question. Sending and regenerating wait for readiness. The count represents chunks currently available, not a percentage of a known total. A large initial embedding run can take several minutes; subsequent launches reuse persisted caches where possible.

If the directory disappears or indexing does not become ready, the UI reports an error. Restore the directory, inspect the project's `logs/indexer.log`, correct the runtime or configuration, and use **Retry**. Repeated process crashes need the underlying error fixed; Retry does not install a missing library.

## Know where indexes live

Each project uses its own local index directory and vector namespace under Codeberg home. The default backend is `usearch`. Advanced deployments can configure `CBERG_INDEX_BACKEND=qdrant` with `CBERG_VECTORDB_URL`, or `pgvector` with `CBERG_POSTGRES_URL`. Remote backends require their service to be configured and reachable; they store vector data outside your machine.

Deleting only indexed files leaves saved knowledge and chats intact. Re-adding the same source root rebuilds search data. See [Projects](/docs/projects) and [Data and maintenance](/docs/storage) before removing a project's full history.
