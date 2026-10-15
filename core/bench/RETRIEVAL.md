# Hard embedding retrieval benchmark

This focused harness evaluates the configured embedding adapters against source
functions extracted by Codeberg's own C chunker. It also measures steady-state
embedding throughput and single-query worker round trips. It does not modify
the user's model settings, saved chats, or indexes.

The fixed fixture has 64 queries:

- 28 behavioral questions with explicit repository function targets. Queries
  avoid asking for an exact function name. Cases include broken-pipe handling,
  hash collisions, bounded retries, stale knowledge, PID reuse, and transaction
  schema compatibility.
- 28 queries over 14 minimal pairs. These snippets share nearly all their code
  but differ in an edge condition, such as expiry equality, preserving cached
  null, cancellation propagation, optimistic revision checks, or lease ownership.
- 8 queries over 4 long pairs with decisive logic after 100 identical bookkeeping
  lines. This group is reported separately because the current Qwen and Jina
  adapters truncate earlier than EmbeddingGemma.

Every query ranks against the entire corpus. The default corpus has 2,000 unique
production functions, plus 36 controlled snippets. Exact duplicate bodies are
deduplicated with aliases retained. All annotated targets are retained; other
functions are chosen by stable SHA-256 order. Tests, dependencies, and generated
build files are excluded. Corpus files contain only chunk bodies as embedding
inputs; paths and symbols are used for labeling and reporting.

## Reproduce

Run from a source checkout. Pass that checkout explicitly with `--root`. Use a
working C shared library from `make build`; alternatively use an isolated build
without ONNX when the local ONNX runtime cannot load:

```sh
REPOSITORY_ROOT="$(git rev-parse --show-toplevel)"
cmake -S core -B build/embedding-benchmark/core-build \
  -DCMAKE_BUILD_TYPE=Release -DONNXRUNTIME_INCLUDE_DIR=OFF -DONNXRUNTIME_LIB=OFF
cmake --build build/embedding-benchmark/core-build -j10

python3 -m venv build/embedding-benchmark/venv
build/embedding-benchmark/venv/bin/python -m pip install \
  mlx-vlm==0.7.8 mlx-embeddings==0.1.0 transformers==5.19.0 \
  'sentence-transformers[image]==6.1.0' onnxruntime==1.27.0
```

MLX needs Apple Silicon. On another platform, omit its packages and benchmark
Sentence Transformers / ONNX only. Adjust the shared library extension from
`.dylib` to `.so` on Linux.

```sh
build/embedding-benchmark/venv/bin/python core/bench/retrieval_corpus.py \
  --root "$REPOSITORY_ROOT" \
  --library build/embedding-benchmark/core-build/libcodeberg.dylib \
  --output build/embedding-benchmark

python3 scripts/embedding_setup.py embeddinggemma-2-fp32-mlx \
  google/embeddinggemma-2 build/embedding-benchmark/gemma-mlx/model.safetensors \
  build/embedding-benchmark/venv

build/embedding-benchmark/venv/bin/python core/bench/bench_retrieval.py \
  --backend gemma-mlx --model build/embedding-benchmark/gemma-mlx \
  --corpus build/embedding-benchmark/corpus.json \
  --cases build/embedding-benchmark/cases.json \
  --output build/embedding-benchmark/gemma-mlx.json --trials 5
```

For Sentence Transformers, prepare `embeddinggemma-2` with a `modules.json`
destination, then use `--backend sentence-transformers --model <model-directory>`.
For Qwen, prepare `qwen3-fp16-mlx`, then use `--backend mlx --model <model-directory>`.
For Jina, use `scripts/fetch-model.sh` and
`--backend jina-onnx --model <model.onnx>`.

After setup, worker inference uses local files with `HF_HUB_OFFLINE=1`. Retain
the generated corpus/case files and their hashes when comparing revisions.
The corpus records its source paths, symbols, and line spans so gold targets can
be reviewed. The runner saves every query's rank and top ten candidates, plus
raw vectors in a separate NumPy file.

## Interpret results

Hit@K means at least one annotated function appears in the first K candidates.
MRR uses the reciprocal rank of the first relevant candidate across the entire
corpus. Pair accuracy checks whether the intended snippet outranks its nearly
identical counterpart, even when neither appears near the global top.

Retrieval uses normalized float32 vectors and exhaustive cosine ranking.
There is no lexical fusion, reranking, HNSW approximation, or index scalar
quantization. This isolates embedding behavior rather than whole-agent answer
quality. The hand-authored local fixture is a diagnostic set, not a standard
benchmark or a statistically representative assessment of all code search.

Performance uses the existing indexer's 1,024-row sort window, 96-row call cap,
and 32 KiB text budget, charging each row at most 1 KiB. Throughput is the median
of five runs over 256 fixed length-quantile production chunks, after an excluded
warm-up. Query latency includes the production worker's binary round trip and
embedding, measured individually in five shuffled passes. Ranking time and
model load are reported separately. Downloads and model conversion are excluded.
Peak RSS is the process high-water mark; it is not a measurement of total Metal
GPU memory. Runtime and hardware differences must accompany speed comparisons.

Gemma uses text-only FP32, 8,192 tokens, and separate code-query/document prompts.
The configured Qwen MLX adapter uses FP16, 512 tokens, and no instruction prefix.
The harness also records a Qwen reference using a code-search query instruction
without changing the production adapter. Jina uses the local ONNX checkpoint,
CPU execution, masked mean pooling, normalization, and the current 256-token
window; its benchmark-only Python ONNX adapter is not the C runtime, so its
timings include different adapter overhead. Actual model dtype and truncation
counts should be reviewed alongside quality scores.

## Report and checks

The completed local run is recorded in
[the 2026-10-14 report](../../docs/benchmarks/embedding-retrieval-2026-10-14.md),
with a sibling JSON summary containing every query's first relevant rank.
The main report uses the current 8,192-token Gemma cap. A separate
[2,048-token comparison report](../../docs/benchmarks/embedding-retrieval-2026-10-14-2048.md)
preserves that rerun on the same machine and frozen dataset; its Qwen and Jina
measurements are retained from the initial run with unchanged adapters.
Raw comparison results live in `build/embedding-benchmark/2048/`.
After all four runs finish, regenerate the report with:

```sh
build/embedding-benchmark/venv/bin/python core/bench/report_retrieval.py \
  --input build/embedding-benchmark \
  --output docs/benchmarks/embedding-retrieval-2026-10-14.md \
  --date 2026-10-14 --hardware 'describe the machine used'

build/embedding-benchmark/venv/bin/python -m unittest discover \
  -s core/bench -p 'test_retrieval_*.py'
```

For the retained 2,048-token rerun, use `--input build/embedding-benchmark/2048`,
set `--output docs/benchmarks/embedding-retrieval-2026-10-14-2048.md`,
and add `--note 'Gemma rerun at 2,048 tokens; Qwen and Jina retained from the
earlier same-day run with unchanged adapters and identical frozen inputs.'`.
