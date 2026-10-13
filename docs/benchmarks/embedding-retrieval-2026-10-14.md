# Embedding retrieval benchmark — 2026-10-14

Measured on Apple M4 MacBook Air, 10 CPU cores, 24 GB unified memory, macOS 26.6.2. This compares the current Codeberg adapters on a fixed hand-authored local diagnostic set.

Gemma uses the restored 8,192-token input cap in both FP32 text-only runtimes. These measurements are from the original 8,192-token run. The separate [2,048-token comparison](embedding-retrieval-2026-10-14-2048.md) retains the subsequent experiment on the same frozen inputs.

## Findings from this run

Highest first-hit accuracy: 40.6% (EmbeddingGemma 2 / MLX FP32). Highest top-five recall: 71.9% (Qwen3 + query instruction (reference)). Fastest measured throughput: Jina v2 code / ONNX CPU. The results show tradeoffs between ranking quality, latency, and input limits. Jina's timing uses the benchmark-only Python ONNX adapter.

MLX matched Gemma's CPU retrieval ranks on 64/64 queries, while reducing median query latency by a factor of 1.82 and increasing median throughput 1.25×. The inference settings remained text-only FP32.

Gemma chose the correct side in 16 of 28 short minimal-pair queries, and ranked the intended long-body snippet first on 0 of 8 cases. Gemma's 8,192-token cap truncated 0 of 8 long-body snippets. Qwen and Jina use the shorter input caps listed below.

## Dataset and scoring

2,036 candidates: 2,000 unique production functions from this working tree plus 36 controlled snippets. 64 fixed queries: 28 repository behaviors, 28 minimal-pair cases, and 8 long-body cases. Every query searches the entire corpus with exhaustive normalized float32 cosine similarity. No lexical fusion, reranker, approximate index, or index quantization is included.

Targets and queries were frozen before scoring. Near-identical snippets test expiry boundaries, cached null, optimistic writes, transaction failure, cancellation, directory containment, vector normalization, pagination, promise lifetime, explicit zero, leases, authentication comparison, atomic writes, and redaction. Long fixtures place the deciding code after 100 identical bookkeeping lines.

## All 64 hard queries

| Model | Hit@1 | Hit@5 | Hit@10 | MRR |
| --- | --- | --- | --- | --- |
| EmbeddingGemma 2 / MLX FP32 | 40.6% | 65.6% | 79.7% | 0.542 |
| EmbeddingGemma 2 / CPU FP32 | 40.6% | 65.6% | 79.7% | 0.542 |
| Qwen3 0.6B / MLX FP16 | 32.8% | 68.8% | 75.0% | 0.491 |
| Jina v2 code / ONNX CPU | 23.4% | 68.8% | 73.4% | 0.439 |
| Qwen3 + query instruction (reference) | 34.4% | 71.9% | 79.7% | 0.512 |

## Repository behaviors — 28 queries

| Model | Hit@1 | Hit@5 | Hit@10 | MRR |
| --- | --- | --- | --- | --- |
| EmbeddingGemma 2 / MLX FP32 | 57.1% | 82.1% | 89.3% | 0.691 |
| EmbeddingGemma 2 / CPU FP32 | 57.1% | 82.1% | 89.3% | 0.691 |
| Qwen3 0.6B / MLX FP16 | 42.9% | 82.1% | 92.9% | 0.585 |
| Jina v2 code / ONNX CPU | 32.1% | 67.9% | 78.6% | 0.496 |
| Qwen3 + query instruction (reference) | 46.4% | 85.7% | 96.4% | 0.626 |

## Minimal differences — 28 queries

| Model | Hit@1 | Hit@5 | Hit@10 | MRR | Correct side of pair |
| --- | --- | --- | --- | --- | --- |
| EmbeddingGemma 2 / MLX FP32 | 35.7% | 64.3% | 82.1% | 0.513 | 57.1% |
| EmbeddingGemma 2 / CPU FP32 | 35.7% | 64.3% | 82.1% | 0.513 | 57.1% |
| Qwen3 0.6B / MLX FP16 | 32.1% | 75.0% | 78.6% | 0.536 | 53.6% |
| Jina v2 code / ONNX CPU | 21.4% | 89.3% | 89.3% | 0.506 | 46.4% |
| Qwen3 + query instruction (reference) | 32.1% | 78.6% | 85.7% | 0.542 | 53.6% |

## Decisions late in long bodies — 8 queries

| Model | Hit@1 | Hit@5 | Hit@10 | MRR | Correct side of pair |
| --- | --- | --- | --- | --- | --- |
| EmbeddingGemma 2 / MLX FP32 | 0.0% | 12.5% | 37.5% | 0.120 | 50.0% |
| EmbeddingGemma 2 / CPU FP32 | 0.0% | 12.5% | 37.5% | 0.120 | 50.0% |
| Qwen3 0.6B / MLX FP16 | 0.0% | 0.0% | 0.0% | 0.005 | 50.0% |
| Jina v2 code / ONNX CPU | 0.0% | 0.0% | 0.0% | 0.007 | 37.5% |
| Qwen3 + query instruction (reference) | 0.0% | 0.0% | 0.0% | 0.006 | 50.0% |

## Runtime measurements

Models ran sequentially. Throughput is the median of 5 warmed runs over the same 256 length-quantile production chunks, using the indexer's sort window and call budget. Latency is 320 individual query round trips across 5 shuffled passes, including worker inference and IPC, excluding ranking. Model load includes the readiness probe. Initial corpus pass excludes model load and setup. Peak RSS is not total Metal memory. Different precision and truncation limits affect comparisons.

| Model | Dimensions | Initial corpus (s) | Chunks/s | Query median (ms) | Query p95 (ms) | Peak RSS (GiB) |
| --- | --- | --- | --- | --- | --- | --- |
| EmbeddingGemma 2 / MLX FP32 | 768 | 117.8 | 9.40 | 20.27 | 30.60 | 2.29 |
| EmbeddingGemma 2 / CPU FP32 | 768 | 237.7 | 7.51 | 36.80 | 44.66 | 6.79 |
| Qwen3 0.6B / MLX FP16 | 1024 | 186.1 | 4.25 | 35.39 | 83.44 | 1.89 |
| Jina v2 code / ONNX CPU | 768 | 106.9 | 18.59 | 10.92 | 14.75 | 1.32 |

Qwen's instruction reference shares the same document vectors and throughput as its configured adapter. Its median query latency was 42.57 ms and p95 48.99 ms.

| Model | Throughput trial durations (s) | Load (s) | Ranking (ms/query) |
| --- | --- | --- | --- |
| EmbeddingGemma 2 / MLX FP32 | 21.42, 25.42, 28.12, 27.24, 27.72 | 3.73 | 0.756 |
| EmbeddingGemma 2 / CPU FP32 | 34.10, 34.35, 33.75, 33.51, 37.71 | 4.60 | 0.324 |
| Qwen3 0.6B / MLX FP16 | 60.30, 52.14, 49.78, 68.73, 68.83 | 3.79 | 1.025 |
| Jina v2 code / ONNX CPU | 14.41, 13.53, 13.77, 13.78, 13.41 | 2.74 | 0.585 |

## Adapter settings and truncation

| Model | Input cap | Documents truncated | Token p50 / p95 / max |
| --- | --- | --- | --- |
| EmbeddingGemma 2 / MLX FP32 | 8192 | 0 | 135 / 504 / 2455 |
| EmbeddingGemma 2 / CPU FP32 | 8192 | 0 | 135 / 504 / 2455 |
| Qwen3 0.6B / MLX FP16 | 512 | 67 | 104 / 418 / 2239 |
| Jina v2 code / ONNX CPU | 256 | 451 | 118 / 463 / 2169 |

Gemma is text-only and unquantized FP32 in both runtimes, with `CodeRetrieval` queries and `Document` corpus prefixes. Qwen weights were verified as FP16. Its configured MLX worker uses 512 tokens and omits a query instruction; the reference adds a code-search instruction in the supported `Instruct: ...` / `Query: ...` format. [Qwen's model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) documents instruction use. This reference does not change the production adapter.

Jina uses the existing local quantized ONNX checkpoint, CPU execution, 256-token truncation, masked mean pooling, and normalization. Its benchmark-only Python ONNX adapter mirrors those operations but is not the production C runtime; timing includes different adapter overhead. The 256/512-token caps are Codeberg settings, not the architectures' maximum context capacities.

## MLX / CPU numerical comparison

Across all corpus and query vectors, minimum MLX-to-CPU cosine was 0.99999988. The first relevant rank matched on 64/64 queries. Small numerical differences can alter ordering for almost identical snippets.

## Inspect the misses

**r01** — Find the C routine that survives a broken child input pipe without letting the signal kill the whole indexer, and restores the caller's signal mask afterward.

| Model | Relevant rank | First candidate |
| --- | --- | --- |
| EmbeddingGemma 2 / MLX FP32 | 103 | `core/src/graph/resolve_pkg.c::walk_cb` |
| EmbeddingGemma 2 / CPU FP32 | 103 | `core/src/graph/resolve_pkg.c::walk_cb` |
| Qwen3 0.6B / MLX FP16 | 2 | `core/cmd/cberg-index/ipc.c::ipc_thread` |
| Jina v2 code / ONNX CPU | 37 | `core/src/watch/watch_inotify.c::watch_platform_stop` |
| Qwen3 + query instruction (reference) | 2 | `core/cmd/cberg-index/ipc.c::ipc_thread` |

**r20** — Which shutdown path waits for index sidecars to be saved after an interrupt, then forcibly terminates the child only after a grace period and still waits for completion?

| Model | Relevant rank | First candidate |
| --- | --- | --- |
| EmbeddingGemma 2 / MLX FP32 | 53 | `daemon/internal/bootstrap/ready.go::WaitIndexer` |
| EmbeddingGemma 2 / CPU FP32 | 53 | `daemon/internal/bootstrap/ready.go::WaitIndexer` |
| Qwen3 0.6B / MLX FP16 | 914 | `agent/src/web/runtime/shutdown.ts::installShutdown` |
| Jina v2 code / ONNX CPU | 12 | `core/cmd/cberg-index/main.c::main` |
| Qwen3 + query instruction (reference) | 148 | `agent/src/web/runtime/shutdown.ts::installShutdown` |

**expiry-b** — Retrieve the value when its expiry equals the current instant; reject it only once that instant is in the past.

| Model | Relevant rank | First candidate |
| --- | --- | --- |
| EmbeddingGemma 2 / MLX FP32 | 2 | `fixture/expiry::a` |
| EmbeddingGemma 2 / CPU FP32 | 2 | `fixture/expiry::a` |
| Qwen3 0.6B / MLX FP16 | 2 | `fixture/expiry::a` |
| Jina v2 code / ONNX CPU | 2 | `fixture/expiry::a` |
| Qwen3 + query instruction (reference) | 2 | `fixture/expiry::a` |

**linked-cancellation-a** — Which request relays the parent's cancellation to the network operation and removes the listener after completion?

| Model | Relevant rank | First candidate |
| --- | --- | --- |
| EmbeddingGemma 2 / MLX FP32 | 102 | `agent/web-ui/src/lib/exit-timer.ts::wait` |
| EmbeddingGemma 2 / CPU FP32 | 102 | `agent/web-ui/src/lib/exit-timer.ts::wait` |
| Qwen3 0.6B / MLX FP16 | 88 | `core/src/watch/watch_fsevents.c::watch_platform_destroy` |
| Jina v2 code / ONNX CPU | 16 | `agent/web-ui/src/lib/exit-timer.ts::cancel` |
| Qwen3 + query instruction (reference) | 60 | `core/src/watch/watch_fsevents.c::watch_platform_destroy` |

**long-null-a** — Find the long bookkeeping function that returns a cached null without calling the fallback loader.

| Model | Relevant rank | First candidate |
| --- | --- | --- |
| EmbeddingGemma 2 / MLX FP32 | 251 | `core/src/common/strmap.c::hash_key` |
| EmbeddingGemma 2 / CPU FP32 | 251 | `core/src/common/strmap.c::hash_key` |
| Qwen3 0.6B / MLX FP16 | 1309 | `fixture/cached-null::b` |
| Jina v2 code / ONNX CPU | 1971 | `fixture/cached-null::b` |
| Qwen3 + query instruction (reference) | 1260 | `fixture/cached-null::b` |

**long-zero-a** — Find the long record-processing routine whose final default preserves an explicit zero limit.

| Model | Relevant rank | First candidate |
| --- | --- | --- |
| EmbeddingGemma 2 / MLX FP32 | 79 | `core/cmd/cberg-index/ipc.c::list_cap` |
| EmbeddingGemma 2 / CPU FP32 | 79 | `core/cmd/cberg-index/ipc.c::list_cap` |
| Qwen3 0.6B / MLX FP16 | 341 | `core/cmd/cberg-index/ipc.c::ipc_cap_truncated` |
| Jina v2 code / ONNX CPU | 982 | `core/cmd/cberg-index/ipc.c::ipc_clamp_want` |
| Qwen3 + query instruction (reference) | 184 | `core/cmd/cberg-index/ipc.c::ipc_cap_truncated` |

## Scope and reproducibility

This is a small hand-authored repository-specific fixture with strict function-level labels. The controlled pair snippets are synthetic, and an adjacent helper that might be useful to an agent is still scored as a miss if it is not an annotated target. Results should not be generalized to all repositories, languages, or end-to-end answer accuracy. Long-body scores are separated because the current adapter limits give the models different access to the deciding tail. 5 timing trials expose run-to-run variation on this machine; model order was fixed.

See [harness instructions](../../core/bench/RETRIEVAL.md) and [fixed queries and snippets](../../core/bench/retrieval_cases.json). Raw results, every query's top ten candidates, corpus bodies, vectors, logs, and model artifacts are retained under `build/embedding-benchmark/` (gitignored).

```json

{
  "corpus.json": "cb38477342c1898da3aafa487c080960f65288fcb7c4825a6510fec262dfe4c3",
  "cases.json": "9fee8d6dafbd803d6dac8a2386324683da85f176407a9198155cf127d77107a1",
  "head": "0f8ff1c032fe8657b29f2365da24b78ef5f69e7d",
  "working_tree_diff_sha256": "2a1770d0e099d79070403941f658287769fa03fca7d814e03ac8fcb86995708c",
  "fixture_sha256": "df42c4dff5733d2d87bccdb33da9c79fa631b6a35ba4cf1e9407340cb2c76062"
}

```
