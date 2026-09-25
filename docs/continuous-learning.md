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
└── datasets/{eval,embedding}/
```

Event appends are synced before the feedback endpoint acknowledges them. Job and
knowledge writes use a synced temporary file plus atomic rename. Processing jobs
carry leases; an expired lease returns to `pending` after restart. Transient
failures use bounded exponential backoff and permanent/invalid responses move to
`failed`.

SQLite is deliberately not required. JSONL remains canonical, local lexical
search provides the initial projection, and the existing usearch index is not
reused because it stores vectors and numeric keys rather than ordered events,
feedback supersession, job state, or provenance. A future learning-specific
usearch sidecar can add semantic recall without becoming the source of truth.

## Model and feedback

Set `CODEBERG_SUBAGENT_MODEL=provider:model` (or `--subagent-model`) to choose the
background knowledge model. It defaults to `CODEBERG_MODEL`.

The browser UI offers `Not useful`, `Partially useful`, `Mostly correct`, and
`Solved` on every completed assistant message. Changing a rating appends a new
feedback event with `supersedes_feedback_id`; previous ratings remain immutable.
A solved rating queues extraction. Downgrading a solved rating requeues the same
stable job and marks knowledge supported by that interaction as
`needs_verification`.

The knowledge worker receives every attempt in the logical interaction, feedback
history, retrieval/tool trajectory, evidence cited by the answer, repository
branches/commits, and matching existing artifacts. It updates rather than
duplicates matching knowledge and records source interaction/commit provenance.

## Retrieval and export

Agents receive two local tools:

- `search_knowledge`: distilled findings, treated as hints and verified against current code
- `search_learning`: raw attempts, corrections, and failures

The standalone CLI supports inspection and offline dataset derivation:

```sh
codeberg learning search-learning "scheduled fulfillment"
codeberg learning search-knowledge "fulfillment type lifecycle"
codeberg learning list
codeberg learning show interaction-...
codeberg learning stats
codeberg learning export --type eval
codeberg learning export --type embedding
```

Eval rows contain graded queries and cited files/symbols. Embedding candidates
are emitted only for solved attempts with evidence actually cited in the answer;
retrieved-but-uncited chunks become hard-negative candidates. These labels are
derived at export time and never written back into the raw event stream.

## Collection boundary

The browser session format preserves complete UI tool calls and outputs, so the
initial recorder is attached to browser-session persistence. The one-shot CLI
does not expose equivalent explicit feedback UI and is not silently treated as
a graded learning interaction.
