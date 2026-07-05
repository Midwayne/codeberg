# `bench_search` — compaction A/B

Measures HNSW search throughput before and after `cberg_index_compact()` on a fresh
index each round. Uses random unit vectors (768-dim, cosine metric) — same layout
as production embeddings but without ONNX overhead.

```sh
make build-core
./core/build/bench/bench_search -n 12000 -q 2000 -k 10 -r 5
```

## Results (cloud VM, Release build, Jul 2026)

| Vectors | Compact time | Search delta (mean) | Search delta (best) |
|--------:|-------------:|--------------------:|--------------------:|
| 3,000   | 0.08 s       | −0.6%               | −0.6%               |
| 12,000  | 0.41 s       | −0.7%               | −0.3%               |
| 30,000  | 1.42 s       | +0.4%               | 0.0%                |

**Conclusion:** No measurable search speedup on synthetic workloads — deltas are
within run-to-run noise (~±2%). Compaction still costs O(N) time and blocks
searches while running. Scheduled compaction defaults to **off**; set
`CBERG_INDEX_COMPACT=1` to opt in.

Real embedding distributions (clustered code chunks) may behave differently; re-run
with repo-derived vectors if investigating further.
