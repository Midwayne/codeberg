# Embedding context headers — 2026-11-17

**Result: negative. Not shipped.** Production indexing keeps embedding bare chunk bodies.

Measured on a Linux cloud VM (Intel Xeon @ 2.10 GHz, 4 vCPU, 15 GB RAM) with
Jina v2 code (int8 ONNX, CPU, 256-token window), using the benchmark-only Python
ONNX adapter. Per-query ranks are in the
[sibling JSON](embedding-context-headers-2026-11-17.json).

## Claim tested

> Prefixing each chunk with its location (file path, chunk kind, symbol) before
> embedding improves retrieval MRR, measured outside noise on the hard fixture
> and on a larger natural-query set, without hurting minimal pairs.

The model already encodes token positions internally (ALiBi). This study tests
*structural* position: where a chunk lives in the repository, which
`cberg-index` currently never shows the embedder.

## Variants

Each variant is a header placed before an unchanged body. Queries are not
modified.

| Style | Example header |
| --- | --- |
| `none` | *(baseline: bare body)* |
| `path` | `path: core/src/embed/embed_worker.c` + blank line |
| `path-symbol` | `path: …` / `function: cberg_worker_embed` + blank line |
| `comment` | `// core/src/embed/embed_worker.c · function cberg_worker_embed` |

`comment` uses `#` for Python. Synthetic fixture snippets get one neutral
location (`fixture/snippet.py` or `.ts`, plus the real function name), shared
by both sides of each pair. This prevents fixture IDs such as `fixture/expiry`
from leaking the query's concept.

## Hard fixture (64 queries, 2,036 candidates)

| Style | Repository MRR | Repository Hit@1 | Pairs MRR | Pair accuracy | Long MRR | All MRR | Chunks/s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `none` | 0.530 | 35.7% | 0.534 | 53.6% | 0.007 | 0.466 | 30.2 |
| `path` | 0.591 | 42.9% | 0.396 | 60.7% | 0.002 | 0.432 | 29.2 |
| `path-symbol` | 0.622 | 46.4% | 0.367 | 53.6% | 0.002 | 0.433 | 28.7 |
| `comment` | 0.660 | 57.1% | 0.470 | 57.1% | 0.003 | 0.495 | 29.2 |

On the 28 repository queries, `comment` ranked the target higher than the
baseline on 12, lower on 5, and the same on 11. Its paired-bootstrap ΔMRR is
+0.131, 95% CI [−0.005, +0.264], so the interval includes zero.

On minimal pairs, every header lowered global MRR. The `key: value` styles were
worse on 16–17 of 28 queries; `comment` on 9. The losses concentrate on
3–5 line snippets (lease token, pagination, path boundary), where about 20
header tokens become a large share of the text.

## Doc comment → function (494 queries)

A larger, less hand-tuned check (`core/bench/retrieval_doc_eval.py`). Each
production function in the corpus with a doc comment of at least six words
directly above it becomes a query: that comment. Comments sit outside chunk
spans, so bodies never contain their own query. The function's own name is
masked as "this function".

| Style | Hit@1 | Hit@5 | Hit@10 | MRR | ΔMRR (95% CI) | Better / worse |
| --- | --- | --- | --- | --- | --- | --- |
| `none` | 43.9% | 71.1% | 77.7% | 0.558 | — | — |
| `path` | 45.5% | 69.4% | 76.9% | 0.565 | +0.007 [−0.015, +0.029] | 127 / 142 |
| `path-symbol` | 44.9% | 69.8% | 76.7% | 0.560 | +0.002 [−0.020, +0.024] | 124 / 148 |
| `comment` | 45.5% | 70.9% | 75.9% | 0.571 | +0.013 [−0.007, +0.034] | 132 / 129 |

The effect differs by area. With `comment`, MRR rose in `agent/` (0.423 →
0.478, 223 queries) and `daemon/` (0.423 → 0.471, 40). It fell in `core/`
(0.773 → 0.736, 148) and `launcher/` (0.605 → 0.577, 83).

## Costs

| | `none` | `comment` |
| --- | --- | --- |
| Median document tokens | 121 | 141 |
| Documents over the 256-token window | 410 | 483 |
| Throughput (median of 3, 256 chunks) | 30.5 chunks/s | 29.1 chunks/s |

Shipping would also cost two things in the indexer:

- `embed_unique` could no longer share one vector across byte-identical
  bodies in different files.
- Every existing index would need a full re-embed.

## Decision

No variant improved MRR outside noise on either query set, and every variant
hurt short snippets. Under the repository's evidence rule, the production
change to `cberg-index` was not made.

Directions more likely to pay off:

- Use location at ranking time (path and symbol lexical boosts, graph
  proximity) instead of inside the vector.
- Raise the 256-token window, which already truncates 410 of the 2,036
  candidates before any header is added.

## Reproduce

Prerequisites: a chunk-only shared library build and a Python environment.
These are described in [RETRIEVAL.md](../../core/bench/RETRIEVAL.md).

```sh
V=build/embedding-benchmark/venv/bin/python   # numpy, onnxruntime, transformers
M=models/jina-embeddings-v2-base-code/model.onnx  # scripts/fetch-model.sh
O=build/embedding-benchmark
LIB=$O/core-build/libcodeberg.so

for h in none path path-symbol comment; do
  $V core/bench/retrieval_corpus.py --root . --library $LIB \
    --output $O/hdr-$h --header $h
  $V core/bench/bench_retrieval.py --backend jina-onnx --model $M \
    --corpus $O/hdr-$h/corpus.json --cases $O/hdr-$h/cases.json \
    --output $O/hdr-$h/jina.json --trials 3
done

$V core/bench/retrieval_doc_eval.py --root . --backend jina-onnx --model $M \
  --corpus $O/hdr-none/corpus.json --corpus $O/hdr-comment/corpus.json \
  --output $O/doc-eval.json
```

Corpus hashes: `none` `90928618b707…`, `comment` `3c9abe481a81…`.
Cases hash: `8e130eb960b8…`. The fixture's six stale target paths (functions
moved out of `indexer.c` and `launcher/internal/config/config.go`) were
corrected first, so these numbers are not directly comparable with the
2026-10-14 report.
