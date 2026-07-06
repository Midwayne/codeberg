# Agent accuracy & response quality — roadmap

Status: **planned / not yet implemented.** This is the build spec for improving the
answer accuracy of the `codeberg-ask` / TUI / web agent. Audited 2026-07-01.

The agent is mechanically solid (prompt caching, history compaction, in-loop
pruning, composable tool sources, a loop-middleware seam). The gaps are about
*quality*: several accuracy levers are simply unused, and there is **no way to
measure answer quality today** — so the first move is measurement, then
retrieval (the biggest lever for a code-search agent), then grounding.

## Current state (audited)

| Area | Finding | Where |
|------|---------|-------|
| Vector search | Pure cosine kNN, **no reranking, no fusion**. Only knob is HNSW `ef` oversample (recall, not rerank). | `core/src/search/search.c:13-44`, `core/src/search/index.c:138-172` |
| Chunking | **Symbol-aware** via tree-sitter (whole funcs/classes); 50-line window fallback for unknown langs. Large functions not sub-split. | `core/src/chunk/chunker.c:307-429` |
| Snippets | Capped at **400 bytes** — the model often sees a truncated function even though the chunk's line range is the full symbol. | `core/cmd/cberg-index/indexer.h:41` |
| Lexical search | `grep` exists only as a **separate Go tool**; never fused with vector search. | `daemon/internal/tools/filetools.go:29`, `daemon/internal/httpserver/server.go:30-32` |
| Daemon tools | 12 tools over `/tools`: grep, glob, read_file, list_dir, tree, head, tail, wc, sed, pipe, git_log, git_blame. | `daemon/internal/tools/default.go:5-19` |
| Sampling | **No temperature / topP / seed set anywhere** — provider defaults (~0.7–1.0) for factual code QA. | `agent/src/core/agent.ts:192-216` (none) |
| Stop / steps | `stepCountIs(16)`; timeouts 300s/120s/60s; in-loop pruning via `prepareStep`. | `agent/src/core/agent.ts:49,198,206-215` |
| Verification | **None.** Answer = model's last message verbatim. "verify"/"citations" exist only as *prompt instructions*, not code. | `agent/src/core/agent.ts:138-146`, `agent/src/core/prompt.ts` |
| Evidence | Only `search_code` feeds `sources`; grep/read_file findings are **not** captured as evidence. | `agent/src/core/tools/search-code.ts:40-46`, `agent/src/core/agent.ts:230` |
| Eval | **No eval harness, golden set, or accuracy benchmark anywhere.** Tests are mechanics-only. | (absent) |

## Improvements

Ordered by build sequence. Each: *why it limits accuracy → design → leverage/effort → notes.*

### 1. Eval harness — the foundation (build first)

**Why.** Every change below is a guess until it can be scored. There is no golden
set, no recall metric, no answer-quality judge. Without this we cannot tell if
hybrid search or reranking actually helped — or regressed.

**Design.**
- `agent/eval/cases.jsonl` — golden questions over a known repo (codeberg itself
  is a good fixture). Each case:
  ```jsonc
  {
    "id": "auth-entry",
    "question": "Where is the daemon's HTTP routing defined?",
    "expectFiles": ["daemon/internal/httpserver/server.go"],   // recall@k target
    "expectSymbols": ["routes", "ServeHTTP"],                  // optional
    "rubric": "Names server.go and the route table; cites a line range."
  }
  ```
- `agent/src/eval/score.ts` — **pure, unit-tested** scorers:
  - `fileRecallAtK(cited, expected, k)` — fraction of expected files cited in the
    top-k sources.
  - `citationValidity(answer, daemon)` — fraction of `[path:start-end]` citations
    that resolve to a real file + in-range lines (reuses the citation parser from
    improvement 6).
  - `judge(answer, rubric, model)` — LLM-as-judge → 0–1 score + reason. Optional,
    behind a flag (needs an API key).
- `agent/src/eval/run.ts` + a `codeberg-eval` bin — run each case against a live
  daemon + model, collect `{recall@k, citationValidity, judge}`, print a
  scorecard, write `agent/eval/results/<timestamp>.json`. Exit non-zero if below
  a threshold (so it can gate CI nightly with a key).

**Leverage / effort.** Foundational; medium effort. The scorers are pure and
testable here; the runner needs a daemon + key to run end-to-end (document, don't
gate on it locally).

**Notes.** Keep the golden set small (15–30 cases) and high-signal. Version it;
treat regressions as bugs.

### 2. Sampling / temperature (trivial, immediate)

**Why.** No sampling params are set, so factual code QA runs at the provider's
default temperature (often 0.7–1.0). High temperature → more variance and more
confident-but-wrong citations.

**Design.**
- `AgentOptions.temperature?: number`; thread into the `ToolLoopAgent` settings
  in `ensureLoop()`.
- `temperatureFromEnv(env)` in `core/config.ts`: default **0.2**; `CODEBERG_TEMPERATURE=<n>`
  overrides; `CODEBERG_TEMPERATURE=off|none|default` → use provider default.
- **Guard reasoning models.** OpenAI o-series / gpt-5 reject a custom temperature.
  Add `supportsTemperature(profile)` to `providers/profiles.ts` (reuse the
  existing `gpt-5|o\d` detection) and only set temperature when supported.
- Apply the same low temperature to the summariser (`core/generator.ts`).

**Leverage / effort.** Real consistency win, near-zero effort. Gate behind the
profile guard so it never breaks o-series.

### 3–5. Retrieval cluster (one cohesive module)

These three are best built together as `agent/src/core/retrieval/`, sitting behind
the `search_code` tool source (the tool-source seam already exists, so this is an
adapter swap, not an Agent edit).

#### 3. Bigger retrieval context

**Why.** Chunks are whole symbols, but the 400-byte snippet truncates them — the
model reasons over half a function. This is likely the single biggest accuracy
killer.

**Design.** After ranking, **expand the top-N hits to their full symbol body** by
reading the chunk's own line range: `daemon.callTool("read_file", { path, start_line, end_line })`.
No core/daemon change — the search result already carries the full `start_line..end_line`.
Cap total expanded bytes (e.g. ~6–8 KB across the top hits) to protect the window;
keep the 400-byte snippet for the long tail.

#### 4. Hybrid retrieval (vector + lexical fusion)

**Why.** The model must *choose* between `search_code` (semantic) and `grep`
(lexical), and they are never fused. Code identifiers, error strings, and config
keys are lexical — embeddings miss exact matches.

**Design.** A `hybridSearch(daemon, query, opts)` that:
1. Runs vector (over-fetched, `k * oversample`) and `grep` **concurrently**.
   Derive grep patterns from the query by extracting code-like tokens
   (`[A-Za-z_][A-Za-z0-9_]{2,}`, camel/snake, quoted strings) minus stopwords.
2. Normalises both into candidates keyed by `path` + line span (vector: the chunk
   span; grep: the matched line ± a few lines).
3. Fuses with **Reciprocal Rank Fusion** (`fuse.ts`, pure + tested):
   `score(item) = Σ 1/(k + rank_in_list)`, k≈60.
4. Dedupes overlapping candidates (same file, overlapping lines), preferring the
   vector chunk (it has a symbol + clean span).

**Granularity note.** Vector returns chunk spans, grep returns lines — fusion
keys on `path:line-span`, and overlapping grep lines collapse into the
containing chunk when one exists. Grep-only hits the vector missed are surfaced
as line-pointer candidates and expanded via improvement 3.

#### 5. Reranking

**Why.** Cosine-nearest ≠ most-relevant; the top-1 is often not the best chunk.

**Design (pragmatic, no extra model).** Reranking *is* the fusion + scoring layer:
- RRF already reorders by combined vector+lexical evidence.
- Add a **lexical-overlap boost**: candidates whose path/symbol/snippet contain
  query identifiers score higher.
- Add **MMR-lite diversity** on the candidate text so the top-k aren't 5 near-
  duplicate chunks of the same function.
- (Future) optional LLM/cross-encoder rerank behind a flag — left out of v1
  because it costs a round-trip and the daemon exposes no reranker.

All scoring lives in pure functions (`rerank.ts`) with unit tests; the
orchestrator (`search.ts`) is integration-tested with a fake `DaemonClient`.

**Leverage / effort.** This cluster is where the accuracy actually lives.
Medium-high effort, but isolated behind `searchCodeSource` and fully testable
with daemon mocks.

### 6. Citation verification + evidence capture

**Why.** The prompt demands `[path:start-end]` citations but **nothing checks
them**, and only `search_code` feeds `sources` — so a grep/read_file-derived
answer cites nothing verifiable. This is the trust gap.

**Design.**
- **Citation parser** (`core/citations.ts`, pure + tested): extract
  `[path:start-end]` (and `[path:line]`) spans from the answer text.
- **Verifier**: for each citation confirm the path exists (`glob`/`read_file`)
  and the line range is in-bounds; optionally a cheap check that the cited lines
  are non-empty / plausibly related. Produce a `CitationReport`
  (`valid`, `invalid`, `unverifiable`).
- **Surface it**: attach the report to `AskResult` (e.g. `result.citations`) and
  let the TUI/web flag invalid citations. v1 = verify-and-report; a later
  iteration can feed invalid citations back for a repair round.
- **Evidence capture**: fold `grep`/`read_file` tool calls into the
  `EvidenceLedger` (today only `search_code` contributes), so the ledger and the
  answer's `sources` reflect everything the agent actually looked at. Hook at the
  tool-source layer (each source can report touched `path:line` to the same sink
  `search_code` already uses).

**Leverage / effort.** Directly attacks hallucinated line numbers and incomplete
citations. Medium effort; the parser/verifier are pure and testable.

## Recommended sequence

1. **Eval harness (#1)** + **temperature (#2)** — cheap, and they make everything
   below measurable. Establish a baseline scorecard first.
2. **Retrieval cluster (#3 → #4 → #5)** — biggest accuracy gains; measure each
   step against the baseline. Bigger context first (highest value / lowest risk),
   then fusion, then the rerank/diversity layer.
3. **Citation verification + evidence (#6)** — closes the trust gap once retrieval
   is solid.

Re-run the eval after each step; keep changes that move recall@k / citation
validity / judge score, revert ones that don't.

## Design decisions already settled

- **No core/daemon changes required** for the agent-side wins. Bigger context,
  hybrid, rerank, and citation verification all ride on existing endpoints
  (`/search`, `/tools` → grep/read_file/glob). A future core-side reranker or
  fused `/search` endpoint is possible but not needed for v1.
- **Seams to build on:** the retrieval cluster slots behind `searchCodeSource`
  (`agent/src/core/tools/`); evidence capture reuses its `onResults` sink;
  temperature threads through `AgentOptions` like `reasoning` already does.
- **Reasoning-model safety:** temperature must be gated by `supportsTemperature`.

## Open questions

- **Eval fixture repo:** use codeberg itself, or vendor a small fixed snapshot so
  golden answers don't drift as the code changes? (Leaning: a pinned snapshot.)
- **LLM-judge cost/flakiness:** keep it optional and seed-pinned; rely on
  recall@k + citation validity as the deterministic core metrics.
- **Context budget:** how many bytes to spend expanding top hits before it
  competes with the conversation history budget — tune against the eval.
- **Repair loop:** is verify-and-report enough for v1, or do we want an automatic
  re-ask when citations are invalid? (Leaning: report first, measure, then decide.)
