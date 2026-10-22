# Read-only search composition experiment

`search_bundle` remains **off by default**. It is a fixed search/chunk pipeline,
not an executable coding tool. Enable it with `CODEBERG_SEARCH_BUNDLE_USE=true`.

## Claim and baseline

Falsifiable hypothesis: composing cross-repository searches and chunk reads into
one bounded result reduces model tool round trips and provider tokens without
reducing independently checked task success or increasing end-to-end latency.

The parent baseline is `565dde1468601be250de50d6c6d833eb461b2bf7`. The focused
harness was copied into a temporary checkout created with `git archive` from that
commit and run before implementing the prototype. The final comparison uses the
same three-repository fixture, candidate rankings, eight selected chunk reads,
and 2 ms simulated daemon-call delay in each arm. Independent calls run
concurrently in both arms. The prototype uses round-robin selection so one
repository does not consume the entire bundle. Five trials were collected per
arm; raw samples are in [parent.json](parent.json) and
[prototype.json](prototype.json).

| Median metric | Separate tool waves | Prototype |
| --- | ---: | ---: |
| Harness wall time | 5.131 ms | 5.349 ms |
| Daemon calls | 11 | 11 |
| Model-visible tool waves | 2 | 1 |
| Estimated returned tokens (`JSON characters / 4`) | 15,647 | 2,173 |
| Required fixture-file recall | 100% | 100% |

The daemon timing shows **no latency win**. These sub-millisecond differences
are not evidence of an improvement outside noise. Fewer returned characters and
one fewer tool wave support trying the experiment, but are not measured provider
tokens, model latency, answer accuracy, or proof of retrieval quality on real
repositories. Bounded bodies may omit answer-critical content. The separate-wave
baseline receives all results directly; an agent choosing the existing `batch`
tool or smaller reads may already reduce its context cost.

No real-model adoption claim is made. The environment used for this change had
no configured `CODEBERG_MODEL`, provider credentials, or held-out task file.

## Reproduce the fixture harness

From `agent/`, after installing dependencies:

```sh
CODEBERG_BUNDLE_BENCH_MODE=baseline \
CODEBERG_BUNDLE_BENCH_REPORT=/tmp/search-baseline.json \
npm test -- src/core/tools/search-bundle.bench.test.ts

CODEBERG_BUNDLE_BENCH_MODE=bundle \
CODEBERG_BUNDLE_BENCH_REPORT=/tmp/search-bundle.json \
npm test -- src/core/tools/search-bundle.bench.test.ts
```

To repeat on the parent, archive that commit into a temporary directory, copy
only `search-bundle.bench.test.ts` into its corresponding tools directory, and
install or link the same dependencies there. The baseline branch never imports
the prototype. Keep the fixture and dependency versions identical between arms.

## Full-agent evaluation before adoption

`search-bundle.live.test.ts` runs the actual search agent with the flag off/on,
five trials per held-out task, alternating arm order. It records deterministic
task success, cited expected-file recall, answer-anchor checks, actual provider
input/output token totals, missing-usage counts, provider requests, tool calls,
bundle usage, and wall-clock latency. A task succeeds only if all independently
specified files are retrieved and cited and every answer anchor is present.
These verifiers test the specified task contract; anchors alone do not establish
the semantic correctness of arbitrary prose. Review/calibrate them before using
them as release gates.

Provide reviewed JSONL tasks with this shape; replace the illustrative paths,
commit, and oracle with independently checked values:

```json
{"id":"auth-flow","question":"Trace authentication from the API to the worker and cite the source.","repositories":[{"key":"api","root":"/absolute/api","commit":"PINNED_COMMIT"},{"key":"worker","root":"/absolute/worker","commit":"PINNED_COMMIT"}],"expectedPaths":[{"repo":"api","path":"src/auth.ts"},{"repo":"worker","path":"src/verify.ts"}],"answerIncludes":["authenticate","verifyToken"]}
```

Register these exact keyed roots with the daemon and make sure its index is
current. The harness rejects changed commits and dirty worktrees. Set the
project-scoped daemon URL explicitly when appropriate; the harness does not
restore source repositories or rebuild indexes. Each attempt uses a fresh
context directory with knowledge, learning, web tools, MCPs, and canvas disabled.
Provider prompt caches are outside the harness's control. Pin model versions and
provider settings, retain failures and missing usage, and compare coverage as
well as median token/latency results. `bundleCalls` shows whether the model
actually used the new tool.

```sh
CODEBERG_MODEL=provider:pinned-model \
CODEBERG_DAEMON_URL=http://127.0.0.1:48080/projects/PROJECT_ID \
CODEBERG_BUNDLE_EVAL_TASKS=/absolute/held-out-searches.jsonl \
CODEBERG_BUNDLE_EVAL_REPORT=/absolute/search-comparison.json \
npm test -- src/core/tools/search-bundle.live.test.ts
```

The live harness makes provider calls and uses the usual provider credentials.
Enable by default only after reviewed task success stays at least at baseline
and measured full-agent tokens/latency improve beyond trial variability.
