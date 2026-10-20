# Token efficiency review

Reviewed OpenCode's `dev` branch at
[`d30e990c69efd8a954413a724b35c5a27462f320`](https://github.com/anomalyco/opencode/tree/d30e990c69efd8a954413a724b35c5a27462f320/packages)
on 2026-10-20. The relevant implementation now lives in `packages/core`, rather
than the older `packages/opencode` layout.

## Practices adopted

| Practice in OpenCode | Application in Codeberg |
| --- | --- |
| [Bound tool output and retain a full backing file](https://github.com/anomalyco/opencode/blob/d30e990c69efd8a954413a724b35c5a27462f320/packages/core/src/tool-output.ts) | Codeberg already spills large live results. Resumed history now spills them **before** checking the summary threshold, avoiding a model call when file previews make the history fit. Full results stay recoverable through context tools. |
| [Budget recent context by tokens and preserve exchange boundaries](https://github.com/anomalyco/opencode/blob/d30e990c69efd8a954413a724b35c5a27462f320/packages/core/src/session/compaction.ts) | Replace the default six-message tail with whole user exchanges targeting 25% of the history budget, capped at 15K estimated tokens. The latest exchange always survives. Explicit `keepRecent` counts expand to an exchange boundary. |
| [Keep checkpoints concise and focused on continuing the task](https://github.com/anomalyco/opencode/blob/d30e990c69efd8a954413a724b35c5a27462f320/packages/core/src/session/compaction.ts) | Ask for objective, requirements, decisions, findings, unresolved work, and next steps. Consolidate previous summaries and discard stale details. Reference recoverable evidence instead of copying it. |
| [Reserve and bound summary output](https://github.com/anomalyco/opencode/blob/d30e990c69efd8a954413a724b35c5a27462f320/packages/core/src/session/compaction.ts) | Summary generation now sends an explicit output ceiling: 25% of the history budget, at most 2K tokens. Other generator calls retain their existing defaults. The values are Codeberg policy, not copied OpenCode defaults. |

Codeberg already has stable system prompts, deterministic tool ordering,
provider cache hints, deferred MCP schemas, skill summaries with on-demand
file reads, bounded live tool results, and searchable history archives. This
change preserves those paths rather than adding duplicate mechanisms.

The follow-up implementation adds provider-usage calibration and request sizing,
described below. Native provider compaction remains outside this change because
it requires provider-specific transcript handling.

## Evidence

Falsifiable claims: spilling before fitting can eliminate an unnecessary summary
call, and token-budgeted retention reduces the fitted transcript for long text
exchanges compared with a fixed six-message tail.

Baseline: Codeberg parent commit `662b4d39a4778ec6cc9a82dd4bf705d542b2d80d`.
Captured before implementation with the same focused fixtures and fake summary
generator used in `agent/src/core/context-efficiency.test.ts`. Five trials on each
version produced identical counts within each version; medians follow.

| Fixture and measurement | Parent | Updated |
| --- | ---: | ---: |
| Twelve 600-character messages, 1K-token history budget: fitted estimated tokens | 914 | 314 |
| 70K-character tool result plus short prior turns, 6K-token history budget: summary calls | 1 | 0 |
| Same tool fixture: fitted estimated tokens | 1,113 | 1,177 |

The text fixture uses about 66% fewer estimated tokens after fitting. The tool
fixture keeps more of the original conversation and avoids the summary request;
its final chat input is slightly larger. These measurements use four characters
per token and a fake seven-character summary. They do not establish actual
provider billing, latency, or answer quality. The structured prompt and output
ceiling are covered by behavior/provider-request tests, not a live-model study.

Run the focused harness from the repository root:

```sh
CODEBERG_CONTEXT_BENCH_REPORT=/tmp/codeberg-context-report.json \
  npm test --prefix agent -- --run src/core/context-efficiency.test.ts
```

The optional report contains all five samples. To compare the parent, copy this
test into a separate parent checkout with dependencies available, run the same
command, and inspect the report; its new-behavior assertions will fail on the
parent after writing the measurements.

Initial-pass verification: `make agent-check` (agent/UI lint and typechecks,
lint-rule tests, 848 tests, and both builds). Context-specific tests cover exchange boundaries,
the 15K tail cap, protected latest requests, backing-file recovery, no-op history,
and summary output limits sent to the provider.

## Limits

Recent retention and summaries are lossy by design; text evidence remains in
history and tool-output files. Complete-request enforcement can archive older
completed tool steps inside a long investigation while preserving its user
request and latest complete tool pair. A current request or fixed instructions
and schemas that still do not fit produce an actionable error. Token/media
estimates are approximate. These changes do not alter embedding/indexing costs,
add native compaction, or guarantee cache hits or a particular billing reduction.

The in-app explanation is in `agent/web-ui/src/docs/content/models.md` under
"How chat context stays bounded" and is accessible before model/project setup.

## Follow-up: checkpoints, full requests, and recovery

The second pass adopts these additional practices:

| Practice | Codeberg behavior |
| --- | --- |
| [Durable checkpoints](https://github.com/anomalyco/opencode/blob/d30e990c69efd8a954413a724b35c5a27462f320/packages/core/src/session/history.ts) | Conversation and provider-prompt checkpoints live under `context/checkpoints/`. A hash verifies every original prefix message, model policy, and summarizer policy. Reuse survives restart and edited histories invalidate it. Concurrent identical high-level requests share one summary call. |
| [Complete request sizing](https://github.com/anomalyco/opencode/blob/d30e990c69efd8a954413a724b35c5a27462f320/packages/core/src/session/compaction.ts) | A provider-boundary wrapper includes instructions, active schemas, text, and media estimates. Matching prior provider input counts calibrate underestimated prefixes. Input totals already include cache tokens. Measurements cannot transfer between unrelated conversations or changed schemas. |
| Summarizer-aware limits | Input includes room for the summarizer's instructions and output. A different summarizer gets its own profile; direct runs can set `CODEBERG_SUMMARY_CONTEXT_WINDOW`. Empty/truncated summaries become archive references instead of incomplete checkpoints. |
| [Chunked, paged text reads](https://github.com/anomalyco/opencode/blob/d30e990c69efd8a954413a724b35c5a27462f320/packages/core/src/tool/read-filesystem.ts) | Context files remain limited to 50 MiB. Reads and literal grep scan chunks and can finish early. Output targets 8K characters, with 2K-character fragments and line/UTF-16-column continuation positions. Numbered tails scan the file while retaining bounded excerpts; regex preserves whole-line semantics and may buffer a full line. |
| [Bounded overflow recovery](https://github.com/anomalyco/opencode/blob/d30e990c69efd8a954413a724b35c5a27462f320/packages/core/src/session/compaction.ts) | Three smaller provider-request retries are available. Recovery wraps only model calls, so completed local tools are not replayed. Streams can recover from a context error in their bounded metadata prelude before any generated output is exposed. Later stream errors propagate. Auth, rate limits, and cancellation bypass context recovery. |

The full-request target leaves a 15% estimation margin and reserves output space.
Default chat output is the smaller of 8,192 tokens and 15% of the working window;
an explicitly requested output limit is also bounded by the latter. Summaries
use at most 2K tokens, 25% of the chat history allowance, and 15% of the
summarizer's working window. Smaller compaction requests can lower this further.

For Anthropic budget-based thinking, the request boundary additionally reserves
the thinking tokens added by the SDK, capped by the actual model's output limit.
Capability and effort helpers from the installed Anthropic SDK keep this aligned
with its serializer, using the resolved model ID rather than a catalog alias.
Explicit thinking options take precedence; adaptive thinking shares the answer
reservation. If completion alone cannot fit, the request fails before provider
execution. Fetch-stub tests cover generate and stream requests, manual/default
thinking budgets, adaptive models, and provider-option overrides.

The new guard revealed that verbose default instructions plus schemas could
already exceed the inferred 8K local-model window. Working windows up to 16K
now use concise instructions while keeping full schemas, source-verification
guidance, parallel calls, and database execution/consent rules. This avoids
loosening the budget or simply increasing test windows to hide the issue.

Checkpoint fingerprints hash binary attachments without expanding byte buffers
into JSON arrays. Provider checkpoint restoration reuses original system/media
messages by verified position, preserving typed attachment data and tool pairs.
Meaningful tool payload fields named `providerOptions` are included in hashes;
only actual transport cache annotations are ignored.

### Follow-up benchmark

Claims: unchanged conversation prefixes need fewer summary calls, and first-line
reads/early literal matches need less time than reading/splitting the whole file.
Five trials per version use `context-improvements.bench.test.ts`; no live models
are called. Raw samples are in
[`benchmarks/context-efficiency-2026-10-20.json`](benchmarks/context-efficiency-2026-10-20.json).

A clean archive of parent commit `d9fc811c156d653b5d04687e1d423fd946886e11`
used the same harness and installed dependencies. Its original file cap was
8 MiB, so both versions were measured with an 8 MiB fixture. Medians:

| Measurement | Parent | Updated |
| --- | ---: | ---: |
| Summary calls across three overlapping follow-ups | 3 | 1 |
| First-line read | 3.845 ms | 0.263 ms |
| Literal grep, first-line match, limit 1 | 2.627 ms | 0.250 ms |

The starting workspace also included the earlier approved increase to 50 MiB.
Before this follow-up implementation, a five-trial 50 MiB baseline measured
22.058 ms for the first-line read and 19.959 ms for the early literal match.
The updated medians were 0.260 ms and 0.231 ms. These measurements justify
early-exit scans; they do not claim all-file grep or tails are faster, or measure
live-model latency, billing, peak memory, or answer quality.

Run the opt-in harness on either checkout (copy the harness into the parent
first, and make matching dependencies available):

```sh
CODEBERG_CONTEXT_BENCH_BYTES=8388608 \
CODEBERG_CONTEXT_BENCH_REPORT=/tmp/codeberg-context-followup.json \
  npm test --prefix agent -- --run src/core/context-improvements.bench.test.ts
```

Omit `CODEBERG_CONTEXT_BENCH_BYTES` for the 50 MiB fixture on the updated code.
The benchmark is skipped in ordinary test runs; boundary and behavior tests
remain part of the regular suite.

### Follow-up verification

`make agent-check` passes: 891 tests, agent/UI lint and typechecks, lint-rule
tests, and both builds. The one opt-in benchmark is skipped by the regular
suite and was run separately for each measurement above. Regression coverage
includes checkpoint reuse/invalidation/restart/concurrency, media preservation,
complete request and structured-output schema sizing, provider token
calibration, bounded summarizer recovery, incomplete-summary fallback, Unicode
pagination, 50 MiB boundaries, and model-only retry without duplicate local
tool execution. Streaming tests cover recovery before output and propagation
after output begins. Live-model answer quality and billing were not evaluated.
