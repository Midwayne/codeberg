# The math behind Codeberg's search

This page gives every formula Codeberg uses to turn code into vectors and to rank search
results, from embedding to the final ordering. After each part it explains why the method
works. For the surrounding architecture, see [How the indexer works](indexer-explained.md);
for measured results, see the
[2026-11-17 benchmark](benchmarks/code-search-techniques-2026-11-17.md).

Constants are the current defaults, with links to the code that defines them. Parts that
happen inside a pretrained model, rather than in Codeberg's code, are marked as model
internals.

```text
source file ─▶ chunk ─▶ tokens ─▶ transformer ─▶ mean pool ─▶ L2 normalize ─▶ int8 vector ─▶ HNSW index
                                                                                                │
query ─▶ tokens ─▶ transformer ─▶ mean pool ─▶ L2 normalize ─▶ cosine search (top 64) ◀───────────┘
                                                                        │
                                       keyword rescoring (BM25 + convex fusion) ─▶ search results
                                                                        │
                            hybrid_search only: + ripgrep lines, reciprocal-rank fusion, diversity
```

## Notation

| Symbol | Meaning |
| --- | --- |
| $q$, $d$ | A query and a document (a code chunk) |
| $\mathbf{h}_t \in \mathbb{R}^{D}$ | Transformer output for token $t$; $D = 768$ for Jina v2 and EmbeddingGemma 2 |
| $\mathbf{e}$ | An embedding before normalization; $\hat{\mathbf{e}}$ after |
| $\lVert \mathbf{x} \rVert = \sqrt{\textstyle\sum_i x_i^2}$ | Euclidean (L2) norm |
| $k$ | Number of results requested |
| $P$ | The candidate pool: the 64 nearest chunks |

## 1. Embedding a chunk or a query

### 1.1 Tokens and the input window

A tokenizer maps text to token ids $t_1, \dots, t_n$. Jina v2 uses a BPE tokenizer whose
ids include special start and end tokens. The ONNX adapter keeps at most $T_{\max} = 512$
tokens. When a text is longer, it keeps the first $T_{\max} - 1$ tokens plus the final end
token ([tokenize.c](../core/src/embed/tokenize.c)):

$$
(t_1, \dots, t_n) \;\mapsto\;
\begin{cases}
(t_1, \dots, t_n) & n \le T_{\max} \\
(t_1, \dots, t_{T_{\max}-1},\, t_n) & n > T_{\max}
\end{cases}
$$

Tokens beyond the window do not affect the vector. EmbeddingGemma 2 workers allow 8,192
tokens, including the prompt.

### 1.2 The transformer (model internals)

Each layer mixes information between tokens with multi-head self-attention. For one head,
with query, key and value matrices $Q, K, V$ computed from the layer's input, and key width
$d_k$:

$$
\operatorname{Attention}(Q, K, V) = \operatorname{softmax}\!\left(\frac{QK^{\top}}{\sqrt{d_k}} + B\right) V
$$

Jina v2 has no learned position embeddings. Instead, it adds an ALiBi bias that penalizes
attention between distant tokens linearly. Each head $h$ has a fixed slope $m_h$, taken from
a geometric sequence (for example $m_h = 2^{-8h/H}$ for $H$ heads):

$$
B_{ij} = -\, m_h \, \lvert i - j \rvert
$$

**Why it works:** the $\sqrt{d_k}$ scaling keeps dot products in the range where softmax
still produces useful gradients. The softmax turns similarity into a weighted average, so
each token's output depends on the tokens most relevant to it. ALiBi encodes "nearby
matters more" without a fixed position table, which lets a model trained on short inputs
accept longer ones. Changing the window from 256 to 512 tokens needed no retraining for
this reason.

### 1.3 Mean pooling

The adapter averages the output vectors of the $T$ real tokens, ignoring padding added for
batching ([embed_onnx.c](../core/src/embed/embed_onnx.c), `mean_pool_row`):

$$
\mathbf{e} = \frac{1}{T} \sum_{t=1}^{T} \mathbf{h}_t
$$

### 1.4 L2 normalization

Every vector, from ONNX or a Python worker, is scaled to unit length
([embed.c](../core/src/embed/embed.c), `cberg_l2_normalize`). A zero vector is left
unchanged:

$$
\hat{\mathbf{e}} = \frac{\mathbf{e}}{\lVert \mathbf{e} \rVert}, \qquad \lVert \hat{\mathbf{e}} \rVert = 1
$$

For unit vectors, cosine similarity equals the dot product:

$$
\cos(\hat{\mathbf{a}}, \hat{\mathbf{b}}) = \frac{\hat{\mathbf{a}} \cdot \hat{\mathbf{b}}}{\lVert \hat{\mathbf{a}} \rVert \, \lVert \hat{\mathbf{b}} \rVert} = \hat{\mathbf{a}} \cdot \hat{\mathbf{b}} = 1 - \tfrac{1}{2} \lVert \hat{\mathbf{a}} - \hat{\mathbf{b}} \rVert^2
$$

The last identity is why "nearest by distance" and "most similar by cosine" give the same
ranking.

### 1.5 Queries and documents

| Runtime | Query input | Document input |
| --- | --- | --- |
| Jina v2 (ONNX) | The text | The text |
| EmbeddingGemma 2 (Sentence Transformers) | The `CodeRetrieval` prompt + text | The `Document` prompt + text |
| EmbeddingGemma 2 (MLX) | `task: code retrieval \| query: ` + text | `title: none \| text: ` + text |

A short question and a function body are different kinds of text. Gemma was trained to
place a prompted question near the code that answers it.

### 1.6 Why similar vectors mean relevant code

Embedding models are trained contrastively. For a batch of matching (query, document) pairs
$(q_i, d_i^{+})$, the InfoNCE loss rewards each query for scoring its own document above
every other document $d_j$ in the batch, with temperature $\tau$:

$$
\mathcal{L} = -\frac{1}{N} \sum_{i=1}^{N} \log
\frac{\exp\!\big(\cos(q_i, d_i^{+}) / \tau\big)}{\sum_{j} \exp\!\big(\cos(q_i, d_j) / \tau\big)}
$$

Minimizing $\mathcal{L}$ is softmax classification of "which document is mine?". It pulls
matching pairs together and pushes the others apart on the unit sphere. After training, a
high cosine means "a pair like the ones the model was taught to match", so ranking by cosine
ranks by learned relevance.

Mean pooling followed by normalization ($\S$1.3–1.4) is the shape the model was trained
with. Using a different pooling at search time would break that geometry. The optional
fine-tuning tool in [`training/`](../training/README.md) minimizes this same loss, with
$\tau = 1/20$ and mined hard negatives.

### 1.7 int8 model inference (Jina's default weights)

The default Jina file is dynamically quantized. Before each integer matrix multiply, ONNX
Runtime's `DynamicQuantizeLinear` maps a float tensor $X$ to 8-bit integers using that
tensor's own range:

$$
s = \frac{\max(X, 0) - \min(X, 0)}{255}, \qquad
z = \operatorname{round}\!\left(\frac{-\min(X, 0)}{s}\right), \qquad
X_q = \operatorname{clamp}\!\big(\operatorname{round}(X / s) + z,\; 0,\; 255\big)
$$

$X$ is the whole padded batch, so one text's activations are quantized with a scale that
depends on the other texts in its batch. Measured effect: the same chunk embedded in
different batches had cosine as low as 0.955 to itself (mean 0.984). Retrieval quality was
not worse on average. The fp32 weights are batch-invariant (cosine 1.000000) but 2.7×
slower.

## 2. Indexing

### 2.1 Duplicate bodies share a vector

Each chunk body gets a 128-bit XXH3 content hash
([hash.c](../core/src/common/hash.c)). Chunks with equal hashes, confirmed against the full
digest, are embedded once and the vector is reused
([repo_vectors.c](../core/cmd/cberg-index/repo_vectors.c)). An embedding is a function of
the text, so identical text gives an identical vector (up to the batch effect in $\S$1.7).

### 2.2 Batching cost model

Bodies are sorted by byte length within windows of 1,024, so each inference batch pads only
to rows of similar length. Each embed call takes texts in order until it reaches 96 texts or
this byte budget:

$$
\sum_{i \in \text{call}} \min(\ell_i,\ 2048) \le 32{,}768
$$

Here $\ell_i$ is the body length in bytes. About 2 KiB of code fills the 512-token window,
so a text is charged at most one full window. At least one text is always allowed.

**Why it works:** transformer cost grows with batch size × padded length. Grouping similar
lengths minimizes padding. The budget bounds how long one call holds the embedder, so
interactive queries are not starved during indexing.

## 3. Vector storage and nearest-neighbor search

### 3.1 int8 vectors in the index

Local usearch indexes store int8 vectors by default
([index_config.c](../core/src/search/index_config.c)). Each float vector $\mathbf{x}$ is
scaled by its norm, then truncated toward zero:

$$
q_i = \operatorname{trunc}\!\left(\operatorname{clamp}\!\left(\frac{127\, x_i}{\lVert \mathbf{x} \rVert},\ -127,\ 127\right)\right)
$$

Distance is cosine distance computed on the integers
([usearch.c](../core/src/search/providers/usearch/usearch.c), `i8_cos_checked`). The
reported score is the cosine similarity:

$$
\delta(\mathbf{a}, \mathbf{b}) = 1 - \frac{\sum_i a_i b_i}{\sqrt{\sum_i a_i^2 \; \sum_i b_i^2}},
\qquad \text{score} = 1 - \delta
$$

Qdrant (`"distance": "Cosine"`) and pgvector (`vector_cosine_ops`, score
`1 - (embedding <=> query)`, where `<=>` is cosine distance) also rank by cosine.

**Why it works:** cosine depends only on direction, and scaling by $127/\lVert\mathbf{x}\rVert$
preserves direction. Truncation changes each component by less than $1/127 \approx 0.008$ of
the unit scale, which perturbs cosine slightly. That is enough to swap near-ties, but small
next to the gaps between relevant and unrelated code. Storage drops 4× compared with float32.

### 3.2 HNSW approximate search

The index is a Hierarchical Navigable Small World (HNSW) graph (Malkov & Yashunin, 2018).
Each vector is linked to up to $M$ near neighbors per layer. A vector reaches layer $\ell$
with probability decaying geometrically, from a uniform random $U \in (0, 1]$:

$$
\ell = \left\lfloor -\ln(U) \cdot m_L \right\rfloor, \qquad m_L = \frac{1}{\ln M}
$$

A search starts at the sparse top layer, moves greedily toward the query, and descends. On
the bottom layer it keeps a candidate list of size $ef$ and returns the best $k$.

| Parameter | Value | Source |
| --- | --- | --- |
| Connectivity $M$ | 16 | `index_config.c` |
| Insertion expansion $ef_{\text{add}}$ | 128 | `index_config.c` |
| Search expansion, unfiltered | $ef = \max(64,\ 4k)$ | `search.c` |
| Search expansion, with path/kind/score filters | $ef = \max(128,\ 8 \cdot \text{fetch})$ | `query_chunks.c` |

A filtered search fetches 64 candidates, filters them, and doubles the fetch (64 → 128 →
256) until $k$ results pass or the index runs out. Results from several repositories merge
by score. The engine returns at most 64.

**Why it works:** upper layers have few nodes and long links, so a greedy walk crosses the
space in a few hops. Lower layers refine locally, giving roughly $O(\log N)$ comparisons per
search instead of $N$. A larger $ef$ explores more candidates: better recall, more time. The
result is approximate, and a true nearest neighbor can occasionally be missed.

## 4. Keyword rescoring of semantic results

Code is full of exact names that embeddings blur, for example `retryWithBackoff` versus a
merely similar function. The daemon therefore rescores the dense results with BM25 keyword
relevance ([rescore.go](../daemon/internal/search/rescore.go),
[bm25.go](../daemon/internal/search/bm25.go)). This applies to `search`, `hybrid_search`'s
semantic half, and HTTP `/search`.

### 4.1 Tokens

Text is split into maximal ASCII alphanumeric runs
([tokens.go](../daemon/internal/search/tokens.go)). Each run is split at camelCase,
acronym and letter–digit boundaries, and lowercased. A run with several parts also keeps
its whole form:

```text
parseJSONConfig  →  parsejsonconfig, parse, json, config
HTTPServer x2    →  httpserver, http, server, x2, x, 2
cberg_worker_embed → cberg, worker, embed          (underscore separates runs)
```

Query tokens additionally drop English question words (*where, is, the, find, …*) and
single characters. Repeated query terms count once.

### 4.2 BM25 over the candidate pool

Fetch the 64 nearest chunks, $P$, with $n = \lvert P \rvert$. Let $f(w, d)$ be the count of
term $w$ in chunk $d$, $\lvert d \rvert$ its token count, $\text{avgdl}$ the mean
$\lvert d \rvert$ over $P$ (at least 1), and $\text{df}(w)$ the number of chunks in $P$
containing $w$:

$$
\operatorname{BM25}(q, d) = \sum_{w \in q} \operatorname{idf}(w)\cdot
\frac{f(w, d)\,(k_1 + 1)}{f(w, d) + k_1\left(1 - b + b\,\dfrac{\lvert d \rvert}{\text{avgdl}}\right)}
$$

$$
\operatorname{idf}(w) = \ln\!\left(1 + \frac{n - \text{df}(w) + 0.5}{\text{df}(w) + 0.5}\right),
\qquad k_1 = 1.2,\ b = 0.75
$$

**Why it works** (Robertson & Zaragoza, *The Probabilistic Relevance Framework: BM25 and
Beyond*, 2009):

- **Rarity:** `idf` is the Robertson–Spärck Jones weight. A term found in few chunks is strong
  evidence; one found everywhere, like `err`, is nearly worthless.
- **Saturation:** the term-frequency factor rises with $f$ but levels off at $k_1 + 1$. The
  first occurrence of `backoff` matters a lot, the tenth hardly at all.
- **Length:** $b$ discounts matches in long chunks, which contain many words by chance.

Usually `idf` comes from the whole corpus. Here it comes from the pool, which already
contains the code semantically closest to the query. "Rare in the pool" then means "this
term separates the candidates", which is the question rescoring has to answer. It needs no
index. In the benchmark it kept most of a full-corpus index's gain: +0.128 vs +0.153
repository MRR.

### 4.3 Normalization and convex fusion

Dense and BM25 scores have unrelated scales: cosine lies in $[-1, 1]$, while BM25 is
unbounded. Each is min–max normalized over the pool, and a constant list maps to zeros:

$$
\operatorname{norm}(x_d) = \frac{x_d - \min_{d' \in P} x_{d'}}{\max_{d' \in P} x_{d'} - \min_{d' \in P} x_{d'}}
$$

Results are ordered by a convex combination with $\alpha = 0.7$. Ties keep the dense order
(stable sort), and the top $k$ are returned:

$$
s(q, d) = \alpha \cdot \operatorname{norm}\!\big(\cos(q, d)\big) + (1 - \alpha)\cdot \operatorname{norm}\!\big(\operatorname{BM25}(q, d)\big)
$$

The `score` a caller sees stays $\cos(q, d)$, so `min_score` keeps its meaning.

**Why it works:** semantic and keyword evidence make different errors. Embeddings find code
that does the right thing under a different name; BM25 finds the exact name. When both agree
a chunk rises; when only one does, $\alpha$ decides how much it counts.

Convex fusion keeps how far apart the scores are, unlike rank-only methods (Bruch, Gai &
Ingber, *An Analysis of Fusion Functions for Hybrid Retrieval*, 2023). Equal-weight
reciprocal rank fusion lowered doc-comment MRR here (−0.032), because it gave the much
weaker BM25 ranking an equal vote. $\alpha$ was chosen on 494 doc-comment queries, where
results were flat between 0.65 and 0.8. It was validated on 28 held-out repository
questions: MRR 0.525 → 0.654.

## 5. Hybrid search: semantic chunks plus exact-text lines

`hybrid_search` ([hybrid.go](../daemon/internal/tools/hybrid.go),
[ranking.go](../daemon/internal/search/ranking.go)) defaults to $k = 8$, at most 64.

**Candidates.**

- **Semantic:** $\min(2k, 64)$ chunks, already rescored as in $\S$4.
- **Lexical:** up to $\min(4k, 64)$ ripgrep lines for one pattern, case-insensitive and
  word-bounded. The pattern is the query's longest code-like term (one containing `_`, `-`,
  a digit or an inner capital), otherwise its longest significant word of three letters or
  more.

Lexical lines are ordered by path category (production before tests and generated code),
then path, then line. They have **no relevance score**, only a rank. A line inside a semantic
chunk boosts that chunk. Otherwise each file contributes at most one lexical-only hit, and
`import`, `from`, `#include` and `package` lines in files that already have a semantic hit
are skipped unless the query mentions imports or includes.

**Fusion.** Let $r_v$ be a chunk's semantic rank and $r_\ell$ the rank of a matching line
inside it. $R_v(f)$ and $R_\ell(f)$ are the best semantic and lexical ranks anywhere in file
$f$. With offset $c = 60$, lexical weight $w_\ell = 1.01$ and same-file weight $w_f = 0.3$:

$$
s_{\text{chunk}} = \frac{1}{c + r_v} +
\begin{cases}
\dfrac{w_\ell}{c + r_\ell} & \text{a matching line is inside the chunk} \\[2mm]
\dfrac{w_f\, w_\ell}{c + R_\ell(f)} & \text{otherwise, if a line matched elsewhere in its file} \\[2mm]
0 & \text{otherwise}
\end{cases}
$$

$$
s_{\text{line}} = \frac{w_\ell}{c + r_\ell} + \frac{w_f}{c + R_v(f)}\ \ \big[\text{second term only if the file has a semantic hit}\big]
$$

Each score is multiplied by a source weight $\omega$, and results are sorted by
$\omega \cdot s$:

| Path | $\omega$ | When the query names it |
| --- | --- | --- |
| `build/`, `generated/`, `target/`, `node_modules/` | 0.90 | 1.05 for *build*, *generated* |
| `test/`, `tests/`, `src/test/`, `*_test.go`, `*.spec.ts` | 0.85 | 1.05 for *test(s)*, *spec(s)* |
| Everything else | 1.00 | — |

**Diversity:** walking the sorted list, a file's fourth and later hits are deferred, and are
used only if fewer than $k$ results remain from other files.

**Why it works:** reciprocal rank fusion (Cormack, Clarke & Büttcher, SIGIR 2009) needs only
ranks. That suits this case, because grep lines have no score to normalize. The offset
$c = 60$ flattens differences among top ranks, so neither list dominates through its first
item, and every additional agreeing source adds a bounded amount. $w_\ell = 1.01$ breaks
exact ties in favor of a literal match. The same-file terms give partial credit to evidence
nearby. The weights $\omega < 1$ encode a prior that production code usually answers the
question, unless the query asks for tests or build output.

## 6. The agent's choice of hits to read in full

`search_code` returns compact hits and attaches full bodies (up to 2,500 characters each,
6,000 in total) to three of them ([search-code.ts](../agent/src/core/tools/search-code.ts)).
Let $W$ be the query's distinct words matching `[a-z][a-z0-9_]{2,}`, without a small
stop-word list. Each hit $i$ gets:

$$
\text{expand}(i) = \text{score}_i + \sum_{w \in W}\Big(0.012 \cdot [\,w \subseteq \text{path}_i\,] + 0.025 \cdot [\,w \subseteq \text{symbol}_i \text{ or } \text{snippet}_i\,]\Big)
$$

The three highest, with ties broken by original order, are expanded. Here $[\cdot]$ is 1 when
the word occurs as a substring and 0 otherwise. The bonuses are small next to typical cosine
gaps, so they mostly break near-ties in favor of hits that visibly contain the query's words.

## 7. How changes are measured

Benchmarks rank each query against the whole corpus ([RETRIEVAL.md](../core/bench/RETRIEVAL.md)).
For query $i$ with rank $r_i$ of its first correct chunk, over $N$ queries:

$$
\text{MRR} = \frac{1}{N} \sum_{i=1}^{N} \frac{1}{r_i}, \qquad
\text{Hit@}k = \frac{1}{N} \sum_{i=1}^{N} [\,r_i \le k\,]
$$

Two systems A and B are compared per query, $\Delta_i = 1/r_i^{B} - 1/r_i^{A}$. A paired
bootstrap resamples the $N$ queries with replacement 10,000 times; the 2.5th and 97.5th
percentiles of the resampled means form the 95% interval for $\overline{\Delta}$. A change
ships only when that interval excludes zero on every query set that matters
([AGENTS.md](../AGENTS.md), *Performance changes need evidence*).

**Why it works:** MRR rewards putting the right chunk first, and the user or agent mostly
reads the top results. Pairing removes query difficulty from the comparison: a hard query
is hard for both systems. The bootstrap then shows whether an average gain could come from
a few lucky queries.

## Sources

| Part | Code |
| --- | --- |
| Truncation, pooling, normalization | [tokenize.c](../core/src/embed/tokenize.c), [embed_onnx.c](../core/src/embed/embed_onnx.c), [embed.c](../core/src/embed/embed.c) |
| Prompts | [embedding_worker.py](../scripts/embedding_worker.py), [embedding_gemma_mlx.py](../scripts/embedding_gemma_mlx.py) |
| Duplicates, batching | [repo_vectors.c](../core/cmd/cberg-index/repo_vectors.c), [hash.c](../core/src/common/hash.c) |
| Vector index, search | [index_config.c](../core/src/search/index_config.c), [search.c](../core/src/search/search.c), [usearch.c](../core/src/search/providers/usearch/usearch.c), [query_chunks.c](../core/cmd/cberg-index/query_chunks.c) |
| Keyword rescoring | [tokens.go](../daemon/internal/search/tokens.go), [bm25.go](../daemon/internal/search/bm25.go), [rescore.go](../daemon/internal/search/rescore.go) |
| Hybrid fusion | [hybrid.go](../daemon/internal/tools/hybrid.go), [lexical.go](../daemon/internal/search/lexical.go), [ranking.go](../daemon/internal/search/ranking.go) |
| Hit expansion | [search-code.ts](../agent/src/core/tools/search-code.ts) |
