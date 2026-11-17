# Code search techniques from the literature — 2026-11-17

Twenty papers on code search and retrieval-augmented generation were reviewed.
Each technique that runs locally on CPU without an LLM or GPU training was
tested here. Each one was kept only if it beat noise on two independent query
sets.

**Shipped:**

1. **Keyword rescoring of semantic results** (BM25 with identifier splitting,
   convex fusion). It applies to every embedding model.
2. **Jina's input window raised from 256 to 512 tokens.**

Measured on a Linux cloud VM (Intel Xeon @ 2.10 GHz, 4 vCPU) with Jina v2 code,
int8 ONNX. Unless noted otherwise, results are relative to the production
baseline of 256 tokens and dense-only ranking.

## Query sets

| Set | Queries | What it measures |
| --- | --- | --- |
| Repository fixture | 28 | Hand-written behavioral questions with known target functions ([RETRIEVAL.md](../../core/bench/RETRIEVAL.md)). |
| Minimal pairs | 28 | Near-identical snippets that differ in one edge condition. Reported as a guard against regressions. |
| Doc comment → function | 494 | Each doc comment of six words or more becomes a query, with the function's own name masked ([retrieval_doc_eval.py](../../core/bench/retrieval_doc_eval.py)). |

The corpus is 2,036 candidates: 2,000 production functions plus 36 snippets.
Gains are paired-bootstrap ΔMRR with 95% confidence intervals over 10,000
resamples. A technique counted as a win only when **both** the repository and
doc-comment intervals excluded zero.

Free parameters were chosen on the doc-comment set alone. The repository
fixture then served as held-out validation.

## Results

| Technique (paper) | Repository MRR | ΔRepository | Doc-comment MRR | ΔDoc-comment | Verdict |
| --- | --- | --- | --- | --- | --- |
| Baseline: dense, 256 tokens | 0.525 | — | 0.575 | — | — |
| **BM25 rescoring of dense top-64, α=0.7** [2, 3] | **0.654** | **+0.128 [+0.036, +0.228]** | **0.606** | **+0.031 [+0.015, +0.048]** | **Shipped** |
| **512-token window** [6] | **0.639** | **+0.114 [+0.030, +0.212]** | 0.579 | +0.003 [−0.005, +0.012] | **Shipped**; see note |
| 512-token window + BM25 rescoring | 0.668 | +0.143 [+0.042, +0.251] | 0.605 | +0.030 [+0.016, +0.045] | Both together |
| Full-corpus BM25, convex fusion α=0.8 [2, 3] | 0.678 | +0.153 [+0.046, +0.271] | 0.614 | +0.039 [+0.019, +0.058] | Best, but needs a global index |
| Reciprocal rank fusion, k=60 [1] | 0.633 | +0.108 [−0.014, +0.237] | 0.543 | −0.032 [−0.061, −0.002] | Rejected: hurts doc-comment |
| BM25 alone [3] | 0.429 | −0.096 | 0.375 | −0.201 | Rejected |
| Vector pseudo-relevance feedback (Rocchio), 4 settings [7] | 0.463–0.540 | −0.063 to +0.014 | 0.546–0.563 | −0.012 to −0.029; 3 of 4 significant | Rejected |
| 1,024-token window [6] | 0.633 | +0.108 | 0.578 | +0.003 | No gain over 512 |
| fp32 model instead of int8 | 0.551 | +0.026 [−0.016, +0.076] | 0.580 | +0.005 [−0.005, +0.015] | Rejected: 2.7× slower, within noise |
| Cross-encoder rerank top 20 of dense: jina-reranker-v2 [10] | 0.665 | +0.139 [−0.020, +0.300] | 0.547 | −0.028 [−0.059, +0.004] | Rejected; ~2.5 s/query on CPU |
| Cross-encoder rerank top 20 of hybrid: jina-reranker-v2 [10] | 0.674 | +0.020 vs hybrid [−0.142, +0.183] | 0.541 | −0.065 vs hybrid [−0.094, −0.036] | Rejected: hurts |
| Cross-encoder rerank top 20 of dense: mxbai-rerank-xsmall [10] | 0.469 | −0.057 [−0.217, +0.115] | 0.442 | −0.133 [−0.166, −0.098] | Rejected: hurts |
| **CodeRankEmbed, 512 tokens** [9] | **0.709** | **+0.184 [+0.064, +0.304]** | **0.640** | **+0.065 [+0.035, +0.095]** | **Best model; not shipped (see below)** |
| CodeRankEmbed + BM25 rescoring, vs CodeRankEmbed alone | 0.750 | +0.041 [−0.022, +0.106] | 0.632 | −0.008 [−0.023, +0.007] | Rescoring neutral on a stronger model |
| Late chunking, 2,048-token file windows [5] | 0.493 | −0.032 [−0.176, +0.102]; −0.146 vs 512 [−0.264, −0.043] | 0.470 | −0.106 [−0.142, −0.070] | Rejected: hurts |

Minimal-pair MRR (0.511 at baseline) stayed between 0.509 and 0.563 for every
shipped variant. Long-context fixtures stay unsolved: they run 1,824–1,845
tokens, and their deciding code comes after 1,024.

**Note on 512 tokens.** The doc-comment set is dominated by short functions:
386 of 494 targets fit in 256 tokens. On the 108 queries whose target is longer,
the 512 window improves MRR by +0.034 [+0.003, +0.068]. On the rest the change
is neutral (−0.005, interval touching zero). The improvement appears exactly
where the mechanism predicts.

**CodeRankEmbed** (137M parameters, MIT, from CoRNStack [9]) beat Jina at the
same 512-token window on doc-comment queries: +0.062 [+0.032, +0.092]. The
repository gain was +0.070 [−0.028, +0.167]. Embedding took about twice as long
as Jina int8, because the export is fp32. It is not shipped. Adding it as a
model choice requires one of two sources:

- the official weights, which need `trust_remote_code` (Python from the model
  repository runs at load);
- a third-party ONNX export (tested here), which could not be checked against
  the official weights without PyTorch.

**Rescoring on stronger models.** Keyword rescoring helped Jina significantly.
On CodeRankEmbed it was neutral (−0.008 doc-comment, within noise). Its benefit
shrinks as the dense model improves. The default EmbeddingGemma 2 was not
measured.

**Rerankers and late chunking.** Both rerankers lowered doc-comment MRR. The
code-aware jina-reranker-v2 (CC-BY-NC) also took about 2.5 s per query on
CPU. Late chunking pooled base Jina's token states over whole-file context,
with every query comment removed from that context. It lost to plain
per-chunk embedding on both sets. The paper's strongest results use a model
fine-tuned for late chunking. MaxP over sub-windows [Dai & Callan 2019] was not
run, because the 512-token window already covers 98.6% of chunks whole.

### How the shipped rescoring works

The daemon fetches the indexer's 64 nearest chunks, reads each chunk's lines,
and tokenizes code and query alike:

- lowercase ASCII words;
- camelCase, acronym, and digit splits;
- the whole identifier kept as well;
- English question words and single characters dropped from the query.

It then computes BM25 (k1=1.2, b=0.75) over the pool, with pool-local document
frequencies, and orders by `0.7·norm(dense) + 0.3·norm(BM25)`. The reported
score stays the dense similarity.

Rescoring within the pool captured nearly all of the full-index gain (+0.128 vs
+0.153 repository, +0.031 vs +0.039 doc-comment). It needs no inverted index,
sidecar, or reindex.

α was flat between 0.65 and 0.8 on the doc-comment set, with a peak at 0.7.
BM25's k1 and b barely mattered. The Go implementation ranks all 558 benchmark
pools identically to the Python reference
([retrieval_lexical.py](../../core/bench/retrieval_lexical.py)).

### Measurement noise found along the way

The int8 Jina model quantizes activations per batch. The same chunk embedded
in different padded batches got vectors with cosine similarity as low as 0.955
to each other (mean 0.984). Batching alone moved repository MRR between 0.525
and 0.577.

The fp32 model is batch-invariant (cosine 1.000000). Production-style batching
was not worse on average, so nothing changed. Embeddings in these experiments
use batch size 1 for reproducibility.

## Papers reviewed

| # | Paper | Technique | Status here |
| --- | --- | --- | --- |
| 1 | Cormack, Clarke, Büttcher. *Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods.* SIGIR 2009. | RRF | Tested; rejected |
| 2 | Bruch, Gai, Ingber. *An Analysis of Fusion Functions for Hybrid Retrieval.* TOIS 2023 (arXiv 2210.11934). | Convex score fusion | Tested; **shipped** |
| 3 | Robertson, Zaragoza. *The Probabilistic Relevance Framework: BM25 and Beyond.* FnTIR 2009. | BM25 | Tested; **shipped** in fusion |
| 4 | Li et al. *CoIR: A Comprehensive Benchmark for Code Information Retrieval Models.* ACL 2025 (arXiv 2407.02883). | Benchmark; dense vs. lexical baselines | Informed design |
| 5 | Günther et al. *Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models.* arXiv 2409.04701. | Late chunking | Tested; rejected |
| 6 | Günther et al. *Jina Embeddings 2: 8192-Token General-Purpose Text Embeddings.* arXiv 2310.19923. | Long-context ALiBi encoder | Window tested; **512 shipped** |
| 7 | Li, Mourad, Zhuang, Koopman, Zuccon. *Pseudo Relevance Feedback with Deep Language Models and Dense Retrievers: Successes and Pitfalls.* TOIS (arXiv 2108.11044). | Vector PRF | Tested; rejected |
| 8 | Yu, Xiong, Callan. *Improving Query Representations for Dense Retrieval with Pseudo Relevance Feedback* (ANCE-PRF). CIKM 2021. | Learned PRF encoder | Not tested: needs training |
| 9 | Suresh et al. *CoRNStack: High-Quality Contrastive Data for Better Code Retrieval and Reranking.* arXiv 2412.01007. | CodeRankEmbed | Tested; **best model**, not yet shipped |
| 10 | Nogueira, Cho. *Passage Re-ranking with BERT.* arXiv 1901.04085. | Cross-encoder reranking | Tested (2 rerankers); rejected |
| 11 | Wang et al. *CodeRAG-Bench: Can Retrieval Augment Code Generation?* Findings of NAACL 2025 (arXiv 2406.14497). | Retrievers fail at low lexical overlap | Motivated hybrid |
| 12 | Zhang et al. *cAST: Enhancing Code RAG with Structural Chunking via AST.* arXiv 2506.15655. | AST chunking | Already in Codeberg (tree-sitter) |
| 13 | Husain et al. *CodeSearchNet Challenge.* arXiv 1909.09436. | Benchmark; strong lexical baseline | Informed design |
| 14 | Li et al. *Generation-Augmented Query Expansion for Code Retrieval.* arXiv 2212.10692. | LLM-generated code as query | Not tested: needs an LLM per query |
| 15 | Gao et al. *Precise Zero-Shot Dense Retrieval without Relevance Labels* (HyDE). arXiv 2212.10496. | Hypothetical documents | Not tested: needs an LLM per query |
| 16 | Zhang et al. *RepoCoder: Repository-Level Code Completion Through Iterative Retrieval and Generation.* arXiv 2303.12570. | Iterative retrieval | Not applicable: completion |
| 17 | Wu et al. *Repoformer: Selective Retrieval for Repository-Level Code Completion.* ICML 2024. | Selective retrieval | Not applicable: completion |
| 18 | Liu et al. *GraphCoder: Code Context Graph-based Retrieval.* arXiv 2406.07003. | Graph retrieval | Not tested; graph tools exist separately |
| 19 | Liu et al. *CodeXEmbed: A Generalist Embedding Model Family for Code Retrieval.* arXiv 2411.12644. | 400M–7B code embedders | Not tested: too large for CPU indexing |
| 20 | Kryvosheieva et al. *Efficient Code Embeddings from Code Generation Models.* arXiv 2508.21290. | jina-code-embeddings 0.5B/1.5B | Not tested: next model candidate |

Surveys consulted:

- Tao, Qin, Liu. *Retrieval-Augmented Code Generation: A Survey with Focus on
  Repository-Level Approaches.* arXiv 2510.04905.
- *A Survey of Source Code Search: A 3-Dimensional Perspective.* ACM TOSEM
  2024, doi:10.1145/3656341.

## Limits

- One repository and one embedding model (Jina). The default model,
  EmbeddingGemma 2, was not measured: it needs PyTorch, which this
  environment lacks. Keyword rescoring is model-agnostic, but its gain on
  Gemma is unmeasured.
- Doc-comment queries resemble the code's own comments more than typical user
  questions do. The repository fixture is the closer proxy for real questions.
- Rescoring cannot surface a chunk outside the 64 nearest. Exact identifiers
  are better served by `grep` and `find_symbol`.
- Existing Jina indexes keep 256-token vectors for unchanged chunks until they
  are rebuilt (see the in-app *Indexing* guide).

## Reproduce

The study's code is in [core/bench/techniques/](../../core/bench/techniques/run.py).
Prerequisites:

1. Create the corpus with `retrieval_corpus.py --header none --output build/embedding-benchmark/hdr-none` ([RETRIEVAL.md](../../core/bench/RETRIEVAL.md)).
2. Add a worktree at the corpus commit: `git worktree add --detach build/embedding-benchmark/snapshot <commit>`.
3. Download models into `models/`:
   - `scripts/fetch-model.sh` for Jina int8;
   - `CBERG_MODEL_VARIANT=model scripts/fetch-model.sh models/jina-fp32` for fp32;
   - the Hugging Face ONNX exports for `rerank-jina-v2`, `rerank-mxbai-xs` and `coderankembed`.
4. Run the experiments. Vectors are cached under `build/embedding-benchmark/exp`.

```sh
cd core/bench/techniques
../../../build/embedding-benchmark/venv/bin/python run.py fusion prf windows precision rerank coderank late
```

The shipped pieces have their own references and tests:

```sh
build/embedding-benchmark/venv/bin/python -m unittest discover -s core/bench -p 'test_retrieval_*.py'
make daemon-test     # tokens_test.go, rescore_test.go
CBERG_TEST_MODEL=models/jina-embeddings-v2-base-code/model.onnx core/build/test/test_embed   # ONNX build
```
