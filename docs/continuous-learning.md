# Continuous learning

Codeberg records graded browser-agent interactions as durable local data and
extracts reusable codebase knowledge in the background. It never updates model
weights online.

## Storage

The source of truth is append-only JSONL under `~/.codeberg/learning/events/`.
Knowledge and jobs are file-backed projections that can be rebuilt or retried:

```text
learning/
├── events/YYYY-MM-DD.jsonl
├── knowledge/{services,flows,concepts,debugging}/
├── jobs/{pending,processing,completed,failed}/
└── datasets/{candidates,eval,training,dismissed,embedding}/
```

Event appends are synced before the feedback endpoint acknowledges them. Job and
knowledge writes use a synced temporary file plus atomic rename. Processing jobs
carry leases. An interrupted job is recovered when its lease expires, including
one stopped before the lease was written. Feedback events are reconciled with jobs
on startup if the process stopped after writing feedback but before queueing.
Transient and malformed-model responses retry with bounded backoff (at most five
attempts); permanently invalid interactions end in `failed`. Background updates
never block the chat UI or prompt on shutdown.

SQLite is deliberately not required. JSONL remains canonical, local lexical
search provides the initial projection, and the existing usearch index is not
reused because it stores vectors and numeric keys rather than ordered events,
feedback supersession, job state, or provenance. A future learning-specific
usearch sidecar can add semantic recall without becoming the source of truth.

The TypeScript learning modules have distinct responsibilities:

- `store.ts` and `revision.ts`: append-only interactions and their current revision.
- `service.ts`, `queue.ts`, `source-watcher.ts`: durable job handoff, recovery, and source-change signals.
- `worker.ts`, `knowledge-prompt.ts`, `knowledge-response.ts`, `claims.ts`: KB extraction and evidence validation.
- `dataset-extract.ts`, `retrieval-extract.ts`: pure candidate derivation from recorded interactions.
- `datasets.ts`, `dedup.ts`, `metrics.ts`: immutable storage, split review, and offline evaluation.

The four knowledge directories are categories chosen by the extractor, not
quotas or stages. If the solved investigations are mostly multi-step behavior,
`flows/` can grow while `services/` and `debugging/` remain empty.

## Model and feedback

Set `CODEBERG_SUBAGENT_MODEL=provider:model` (or `--subagent-model`) to choose the
background knowledge model. It defaults to `CODEBERG_MODEL`.

Learning is enabled by default. Set `CODEBERG_LEARNING_USE=false` in the launcher
config (`codeberg config set CODEBERG_LEARNING_USE=false`) or environment to stop
recording interactions, disable learning tools/routes and hide browser feedback.
Existing learning data is retained, and the explicit `codeberg learning` offline
inspection/export command still works. Restart `codeberg` after changing config.

The browser UI offers `Not useful`, `Partially useful`, `Mostly correct`, and
`Solved` on every completed assistant message. Changing a rating appends a new
feedback event with `supersedes_feedback_id`; previous ratings remain immutable.
A solved rating queues extraction; an ungraded chat nudge alone does not.
Downgrading a solved rating requeues the same stable job and marks knowledge
supported by that interaction as `needs_verification`.

Revising feedback on **any** earlier attempt requeues both projections if the
interaction has ever been solved. A later ungraded correction invalidates
previously active knowledge rather than treating an older solved answer as the
winner. Knowledge records the attempt/feedback revision used to verify it; on
revision changes the worker rechecks the latest solved attempt. Restart
reconciliation compares revisions as well as job timestamps.
Verified knowledge search and knowledge export check current event revisions at
read time, so an old fact is hidden immediately after a downgrade, even before
the worker updates its on-disk status. The agent's `search_knowledge` also
returns matching historical artifacts as explicitly labeled
`needs_verification` hints; these require source checking before use. The
offline CLI defaults to verified results; use `search-knowledge --all <query>`
or `list-knowledge` to inspect historical records. Search ranks document titles
and bodies with BM25 rather than substring counts.

## Codebase memory refresh

Knowledge artifacts also track the source files and repository commits that
support them. File hashes detect edits in cited working-tree files even before
a commit; a changed commit conservatively invalidates memories from that repo.
KB search checks these versions at read time. Cited-file directory watchers
signal the existing durable queue as soon as a file changes; startup and a
two-minute full scan cover missed events, moved files, unwatched directories,
and git ref updates. The daemon currently has no push change-event feed.
The worker reads current repository files (never paths outside an indexed root),
passes those fresh excerpts to the model, and accepts an updated active memory
only for claims with a matching source quotation. The worker
computes source line numbers and renders the article from validated claims;
unverified free-form model prose cannot enter an active memory. Source quotes
provide auditable provenance, but do not mechanically prove a claim's semantic
interpretation. If the code is missing or the
model cannot support a replacement, the historical artifact stays marked
`needs_verification` and is excluded from active search and export. Its prior
content is retained for audit, not reused as current evidence. A bounded local
symbol search can locate moved cited files; if it cannot, a later solved
interaction or source change can trigger another refresh.

The model sees bounded excerpts; quote validation checks the full, freshly read
source file (up to the safe file-size limit), without putting the entire file
in the model prompt or logs. If a response mixes valid and invalid quotes, only
grounded claims are saved (up to twelve per document); the rejected claim
indexes and accepted count are recorded in the learning trace.

New solved interactions search both current and historical documents for the
same concept. When fresh file quotes support new facts, the worker updates the
existing document and retains its ID and provisional notes. Legacy interaction
IDs without current evidence move to historical provenance, so they do not
block verified facts from becoming searchable. For an explicit user correction
marked Solved whose claim lacks current code evidence, a matching document can
retain the correction in `User-confirmed notes (not source-verified)` instead
of promoting it to a sourced claim. Notes are redacted, revision-keyed and
deduplicated; they remain provisional even if the document contains other
verified claims. A correction with no matching document is not turned into a
new source-backed fact.

On the first restart after this extraction-policy change, completed knowledge
jobs from the older policy are rechecked once against their durable interactions;
the job version prevents repeated reprocessing on later restarts.

Refresh uses the same job leases, retry policy, and restart reconciliation as
feedback-based learning. Unrelated uncommitted changes are not detected unless
they modify a cited file; committed repo changes are conservatively rechecked.

The knowledge worker receives every attempt in the logical interaction, feedback
history, retrieval/tool trajectory, evidence cited by the answer, repository
branches/commits, and matching existing artifacts. It updates rather than
duplicates matching knowledge and records source interaction/commit provenance.
Its prompt identifies the latest solved attempt as authoritative, treats earlier
solutions and tool output as untrusted context, and requires claim-by-claim code
citations plus a complete replacement body for existing artifacts. If a small
model cannot fit coherent source evidence, the context limiter sends an explicit
insufficient-evidence instruction instead of disconnected text fragments.
The prompt asks for a brief decision reason. `learning-agent.log` records job
events and why extraction was not queued; `learning-agent-trace.log` records
redacted extraction input, the actual bounded model request and selected model,
its response, skip reasons, provisional-note additions and artifact updates,
correlated by job ID. These JSONL files live in `$CODEBERG_LOG_DIR` (normally
`~/.codeberg/logs/`) with owner-only permissions. The trace contains model
output and a short decision reason when supplied, not private model reasoning.

## Dataset capture

The same append-only event log and leased job queue run `extract_dataset` jobs
independently of `extract_knowledge`. Answered tool trajectories and graded
attempts trigger extraction; revised feedback (including downgrades after
success) creates a new immutable candidate revision. On restart the event/job
handoff is reconciled. Jobs are idempotent. Ordered, sanitized tool calls,
inputs, observations, ranked results, corrections, and available model/usage
metadata remain in the raw events; private reasoning is excluded.

Candidates include retrieval trajectories and raw reward/difficulty signals,
explicitly rejected file-level hard negatives, unjudged steering-based negative
candidates, solved SFT trajectories, graded preference
pairs, and RLVR tasks with proposed tool-based verifiers. Answer citations are
proposed evidence, not an oracle. Uncited results remain unjudged. A tool's test
output alone does not establish that a verifier is reproducible.

`DatasetStore.promote(id, 'eval' | 'training', { provenance, oracle? })` is the
review boundary. Eval requires a reviewed oracle and independent provenance
(e.g. user confirmation, tests, static analysis). Promotion checks interaction
IDs, normalized/paraphrased queries, and shared evidence-file families against the
opposite split under a local lock. Candidates never automatically enter training.
Older training-oriented exports require promotion of the matching example kind
and filter out held-out families. Bump
`EXTRACTION_VERSION` (currently 2) and rerun extraction to rebuild new versions
from raw events. Ambiguous steering candidates require reviewed negative paths
before promotion to training; uncited results never become negative labels merely
by being retrieved.
If feedback changes after promotion, the historical promoted file remains
intact, but exports omit that stale revision until a new candidate is reviewed.
The held-out query family remains reserved during review.
`DatasetStore.active('eval' | 'training')` returns only current reviewed rows;
`list(...)` intentionally includes historical versions for auditing.
`candidates/` fills automatically from eligible interactions; `training/` and
`eval/` only fill after explicit reviewed promotion. `embedding/` is an export
destination, not a background queue: `codeberg learning export --type embedding`
writes there only when approved current training retrieval examples are available.
`dismissed/` records candidates set aside by the reviewer without deleting the
original candidate or allowing it to be promoted later.

In the browser UI, the graduation-cap icon in the header opens **Training
review**. The dashboard shows the ready queue, approved training and held-out
evaluation counts, set-aside decisions, outdated revisions, and progress across
current examples. Selecting an example shows its question, answer, feedback,
and proposed evidence. **Teach the agent** approves it for a future training
export; **Test the agent** holds it out and requires independently reviewed
ground truth. Ambiguous negative examples require checked negative paths before
training approval. Neither action retrains the running model automatically.
Only current extraction revisions can be accepted; old revisions remain visible
under **Outdated**. Reviewed decisions remain visible under **Reviewed**.
The offline CLI exposes `codeberg learning candidates`, `codeberg learning
extract <interaction-id>`, and `codeberg learning promote <example-id> eval
user_confirmed oracle.json` (or `training <provenance>`). `oracle.json` is a
locally reviewed JSON object of ground-truth fields such as `files`, `symbols`,
and `dependency_path`.

## Retrieval and export

Agents receive two local tools:

- `search_knowledge`: distilled findings, treated as hints and verified against current code
- `search_learning`: raw attempts, corrections, and failures

The standalone CLI supports inspection and offline dataset derivation:

```sh
codeberg learning search-learning "scheduled fulfillment"
codeberg learning search-knowledge "fulfillment type lifecycle"
codeberg learning search-knowledge --all "fulfillment type lifecycle"
codeberg learning list-knowledge
codeberg learning list
codeberg learning show interaction-...
codeberg learning stats
codeberg learning metrics
codeberg learning score runs.jsonl
codeberg learning export --type eval
codeberg learning export --type embedding
codeberg learning export --type openai-chat
codeberg learning export --type query-positive-negative
codeberg learning export --type preference
codeberg learning export --type knowledge
```

`metrics` scores historical attempts against reviewed eval oracles. `score`
accepts newline-delimited records such as
`{"eval_id":"example-...","hits":[{"repo":"inventory","path":"src/Flow.ts","symbol":"getFlow"}],"tool_calls":4,"retrieved_tokens":1200,"latency_ms":900,"success":true}`.
It reports Recall@1/5/10, oracle repo/symbol hits, success, tool calls, tokens
and latency, including missing-run counts and repo commit provenance. Supply
the same held-out IDs for BM25, embedding, reranker or agent runs; these commands
score results but do not execute the models. Eval export contains only reviewed
held-out examples. Training-oriented embedding/query-positive-negative exports
require promoted interactions, and only reviewed or explicitly rejected file
paths become negatives; retrieved-but-uncited results remain unjudged.

`openai-chat` writes strict `{"messages":[{"role":"user","content":"..."},
{"role":"assistant","content":"..."}]}` rows for solved, standalone turns only.
Context-dependent corrections are excluded. `preference` writes
`{"prompt":[...],"chosen":[...],"rejected":[...]}` only when graded answers
share the same interaction and exact user query; inspect context before using
these pairs for preference tuning. `query-positive-negative` writes
`{"query":"...","positive":["path\\nsymbol\\nsource snippet"],"negative":["..."]}`
from solved, answer-referenced results with source snippets. Negatives are
**unjudged candidates**, not verified irrelevant; review them before training.
Each line is JSONL. Split train/eval by interaction (not attempt) to avoid
correction leakage. The canonical append-only events preserve provenance, while
these portable projections omit machine-specific paths and raw tool payloads.
`knowledge` produces versioned JSONL of artifact metadata and body for offline
indexing and review; it is not automatically a supervised training target.

## Collection boundary

The browser session format preserves complete UI tool calls and outputs, so the
initial recorder is attached to browser-session persistence. The one-shot CLI
does not expose equivalent explicit feedback UI and is not silently treated as
a graded learning interaction.
