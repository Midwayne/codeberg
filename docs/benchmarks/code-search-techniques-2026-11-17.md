# Code search techniques — 2026-11-17

Evidence for two search changes:

1. **Keyword rescoring of semantic results:** BM25 with identifier splitting, combined with
   dense scores by convex fusion (Bruch et al., *An Analysis of Fusion Functions for Hybrid
   Retrieval*, TOIS 2023).
2. **Jina's input window raised from 256 to 512 tokens.**

Measured on a Linux VM (Intel Xeon @ 2.10 GHz, 4 vCPU) with Jina v2 code, int8 ONNX.

## Method

| Query set | Queries | What it measures |
| --- | --- | --- |
| Repository fixture | 28 | Hand-written behavioral questions with known targets ([RETRIEVAL.md](../../core/bench/RETRIEVAL.md)) |
| Doc comment → function | 494 | Each function's doc comment (six words or more, own name masked) as the query |
| Minimal pairs | 28 | Near-identical snippets; a guard against regressions |

Every query ranks against 2,036 candidates. Gains are paired-bootstrap ΔMRR with 95%
intervals (10,000 resamples). A change counted only when both the repository and
doc-comment intervals excluded zero. Free parameters were chosen on the doc-comment set,
with the repository fixture held out for validation.

## Results

| Change | Repository MRR | ΔRepository | Doc-comment MRR | ΔDoc-comment |
| --- | --- | --- | --- | --- |
| Baseline: dense, 256 tokens | 0.525 | — | 0.575 | — |
| **BM25 rescoring of dense top 64, α = 0.7** | 0.654 | **+0.128 [+0.036, +0.228]** | 0.606 | **+0.031 [+0.015, +0.048]** |
| **512-token window** | 0.639 | **+0.114 [+0.030, +0.212]** | 0.579 | +0.003 [−0.005, +0.012] |
| Both | 0.668 | +0.143 [+0.042, +0.251] | 0.605 | +0.030 [+0.016, +0.045] |

Minimal-pair MRR (0.511 at baseline) stayed between 0.509 and 0.563.

**512 tokens:** 386 of the 494 doc-comment targets already fit in 256 tokens. On the 108
targets that are longer, the 512 window improved MRR by +0.034 [+0.003, +0.068]; on the rest
it was neutral. Going to 1,024 tokens added nothing.

**Rejected:** these lowered doc-comment MRR or stayed within noise:

- equal-weight reciprocal rank fusion;
- BM25 alone;
- vector pseudo-relevance feedback (Rocchio);
- fp32 weights (2.7× slower);
- cross-encoder reranking (jina-reranker-v2, mxbai-rerank-xsmall);
- late chunking.

A stronger embedding model, CodeRankEmbed, beat every change here
(+0.184 repository, +0.065 doc-comment). On it, keyword rescoring was neutral
(−0.008 doc-comment, within noise).

## How the rescoring works

The daemon fetches the indexer's 64 nearest chunks and reads each chunk's lines. It tokenizes
code and query the same way:

- lowercase ASCII words;
- camelCase, acronym and digit splits, keeping the whole identifier too;
- question words and single characters dropped from the query.

It computes BM25 (k1 = 1.2, b = 0.75) over the pool, with pool-local document frequencies,
and orders by `0.7·norm(dense) + 0.3·norm(BM25)`. The reported score stays the dense
similarity.

Rescoring inside the pool kept most of the gain of a full-corpus BM25 index (+0.153
repository, +0.039 doc-comment) without an index, sidecar or reindex. α was flat between
0.65 and 0.8. The Go implementation ranks all 558 benchmark pools identically to the Python
reference, [retrieval_lexical.py](../../core/bench/retrieval_lexical.py).

## Limits

- One repository and one model (Jina). The default model, EmbeddingGemma 2, was not
  measured. Rescoring is model-agnostic, but its benefit shrinks as the dense model improves.
- Doc-comment queries resemble the code's own comments more than user questions do. The
  repository fixture is the closer proxy.
- Rescoring only reorders the 64 nearest chunks. Exact identifiers are better found with
  `grep` and `find_symbol`.
- Existing Jina indexes keep 256-token vectors for unchanged chunks until rebuilt.
- The int8 model quantizes activations per batch, so the same chunk's vector varies slightly
  with its batch (cosine as low as 0.955). Results above use batch size 1.

## Tests

```sh
build/embedding-benchmark/venv/bin/python -m unittest discover -s core/bench -p 'test_retrieval_*.py'
make daemon-test     # tokens_test.go, rescore_test.go
CBERG_TEST_MODEL=models/jina-embeddings-v2-base-code/model.onnx core/build/test/test_embed   # ONNX build
```
