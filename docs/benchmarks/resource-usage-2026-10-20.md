# Local resource usage improvements — 2026-10-20

Baseline: `b9a05cd84624c59d8e318f47d20d3a6a8db17d28`. Results compare that
revision with the resource changes in this working tree. Unrelated learning
evaluation changes in the working tree are outside this benchmark.

Machine: Apple M4, arm64, macOS 26.6.2. C builds use Release (`-O3 -DNDEBUG`),
with curl enabled and ONNX/libpq unavailable. Agent harnesses use Node 24.19.0.
Each workload ran five times per version, sequentially, alternating which
version ran first. The table shows medians. Raw output for every trial is in
[resource-usage-2026-10-20.json](resource-usage-2026-10-20.json).

## Results and falsifiable claims

| Claim and measured workload | Parent median | Updated median | Reduction |
| --- | ---: | ---: | ---: |
| Clean local vector saves avoid serializing/replacing unchanged snapshots: 20 saves, 10,000 vectors × 128 dimensions | 54.594 ms; 20 replacements | 0.075 ms; 0 replacements | 99.86% elapsed |
| Identical ordered chunk sets avoid rebuilding maps, strings, and fingerprint: 120,000 chunks | 50.524 ms | 0.989 ms | 98.04% elapsed |
| Repeated import resolution avoids rebuilding the source-path map: 20 passes, 5,000 source files | 187.432 ms | 0.598 ms | 99.68% elapsed |
| Browser subscribers share canvas reads instead of polling independently: 4 subscribers, 1,000 elements, 2.1 seconds idle | 105.639 ms CPU; 20 reads | 7.508 ms CPU; 2 reads | 92.89% CPU |
| Repeated source observations reuse file bytes and hashes: 200 observations of a 460,000-byte file | 86.381 ms CPU | 13.503 ms CPU | 84.37% CPU |
| Idle embedding workers release their process memory: synthetic worker with a touched 64 MiB buffer | 87.625 MiB combined RSS | 8.281 MiB combined RSS | 90.55% RSS |

The timing ranges for the targeted CPU/elapsed improvements did not overlap
between versions. These are focused workloads, not whole-app resource estimates.
No aggregate percentage or battery-life improvement has been measured.

The snapshot is 2,767,780 bytes. Eliminating 20 replacements avoids about
52.8 MiB of logical snapshot output in this workload; physical device writes
were not measured. Mutations still save immediately, failed saves remain dirty,
and a missing snapshot is recreated.

The import benchmark isolates filesystem traversal/map construction using a
small graph with an unresolved import. It measures a warmed cache, excluding
the first map build. Normal edits still traverse graph nodes. New/deleted paths,
directory events, and package metadata invalidate the map.

The canvas's second read comes from a delayed filesystem notification for the
fixture's initial scene write. Normal notifications are debounced for 50 ms.
One shared 15-second reconciliation timer catches missed events and sends
keepalives; the last disconnect releases the feed.

Source observation elapsed time also fell from 72.450 ms to 10.272 ms. Every
observation still performs path authorization and stats the source. The cache
checks device, inode, size, nanosecond mtime and ctime; entries expire after five
minutes and are reread on their next use.

## Memory and latency tradeoffs

The idle fixture sets `CBERG_EMBED_IDLE_SECONDS=1`, waits 1.3 seconds, and queries
again. Production defaults to 300 seconds; `0` disables unloading. Worker RSS
fell from approximately 79.25 MiB to zero in all updated trials. Combined RSS is
the sum of the indexer and its worker, sampled with `ps`; it is not system-wide
physical memory accounting. The indexer, vector index, graph, and watcher remain
resident.

The first query after unloading takes a median **40.332 ms**, versus **0.536 ms**
with the fixture already resident. This worker uses a deterministic protocol
and no real model. Real model loading latency, GPU allocation, ONNX allocator
behavior, and real-model RSS savings remain unmeasured.

Two caches intentionally retain memory to reduce CPU and I/O. Source text is
bounded to 256 files and an estimated 8 MiB budget. The import map scales with
the repository's source paths and stays resident until invalidation or shutdown;
its retained memory was not separately measured. These changes do not evict
whole project indexers or share models across processes.

Changed chunk sets still take the existing transactional rebuild path. The
120,000-chunk single-edit control measured 51.305 ms before and 56.372 ms after,
with broad overlapping ranges (49.731–108.816 ms and 49.490–76.946 ms). There is
no demonstrated improvement for that workload. A per-file transactional table
update remains future work.

## Verification

- `make agent-check`: passed lint, lint tests, typecheck, 837 tests, agent build,
  and web UI lint/typecheck/build.
- `make daemon-check`: passed lint, vet, tests, and build.
- Release core build and all 31 CTest entries: 28 passed, 2 skipped, 1 failed.
  `test_index_providers` fails the pgvector/postgres name checks because libpq
  is absent; the same two assertions fail when linked against the parent
  library. ONNX-dependent `test_embed` and `test_search` skip without a runtime
  and model.
- New regressions cover clean/dirty/reloaded snapshots, retry after save failure,
  no-op chunk identities/order/duplicates, import-cache invalidation, source
  edits/replacement/deletion/expiry/eviction, shared canvas reads, fallback
  reconciliation, chat isolation, and disconnect cleanup.
- Worker protocol fixtures cover idle unloading, lock contention, disabled
  eviction, preserved readiness, and lazy reload for llama,
  sentence-transformers, and gemma-mlx. An IPC regression confirms restarted
  workers do not retain client sockets and prevent response EOF.

## Reproduction

Build the baseline revision and updated checkout separately with the same
compiler and CMake options. Preserve the parent's library before modifying
production code. This run used:

```sh
cmake -S core -B /tmp/codeberg-perf-build -DCMAKE_BUILD_TYPE=Release \
  -DONNXRUNTIME_INCLUDE_DIR:PATH= -DONNXRUNTIME_LIB:FILEPATH=
cmake --build /tmp/codeberg-perf-build -j4
ctest --test-dir /tmp/codeberg-perf-build --output-on-failure
```

Run `bench/bench_chunk_table`, `bench/bench_index_save`, and `bench/bench_imports`
from each build five times. The latter two harnesses are new: compile the same
sources against the parent's static library for its baseline. Define
`CBERG_BENCH_PARENT` only for the parent import harness, which calls the original
public resolver instead of the private cached resolver. For example, on macOS:

```sh
cc -O3 -DNDEBUG -DCBERG_BENCH_PARENT -Icore/include -Icore/bench \
  core/bench/bench_imports.c /path/to/parent/libcodeberg.a \
  -framework CoreServices -lc++ -lcurl -o /tmp/bench-imports-parent
```

For the agent workloads, place the two new `agent/scripts/bench-*.ts` harnesses
in both checkouts and bundle each against that checkout's production sources:

```sh
agent/node_modules/.bin/esbuild agent/scripts/bench-canvas-stream.ts \
  --bundle --platform=node --format=esm --outfile=/tmp/canvas-bench.mjs
node /tmp/canvas-bench.mjs
agent/node_modules/.bin/esbuild agent/scripts/bench-source-observations.ts \
  --bundle --platform=node --format=esm --outfile=/tmp/source-bench.mjs
node /tmp/source-bench.mjs
python3 scripts/bench_resource_idle.py /path/to/build/bin/cberg-index --trials 5
```

Use distinct output paths for baseline and updated bundles, the same Node/Python
executables, five runs per version, and alternate execution order. Do not run
builds or test suites concurrently with timing measurements.
