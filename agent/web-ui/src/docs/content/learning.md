Post-training adapts existing embedding models or LLMs using task-specific data. Reinforcement learning (RL) uses tasks and rewards. Records and settings belong to the selected project.

[Knowledge](/docs/knowledge) has a separate goal: saving codebase findings that improve future answers.

## What you can collect

| Data | Intended use |
| --- | --- |
| Query, relevant chunks, reviewed hard negatives | Embedding or reranker training. |
| Solved answers and successful tool trajectories | Supervised LLM post-training. |
| Chosen/rejected answers to the same question | Preference tuning. |
| Tasks, commits, tool observations, verifiable outcomes | RL environment construction. |

A **hard negative** is a plausible retrieval result reviewed as irrelevant. An uncited file is not automatically a negative.

Recorded attempts can include ordered tools and observations, source evidence, commits, and model/token/timing metadata. Private model reasoning is excluded. A commit identifies the source version; it does not package a runnable environment.

> **Codeberg collects, reviews, exports, and evaluates data.** Model weight updates, training jobs, and executable RL runners run outside the app.

## Enable collection

Open **Settings → Learning** for the project.

| Control | Purpose |
| --- | --- |
| **Record chats and feedback** | Save interaction history. |
| **Dataset capture** | Derive candidates; choose example types separately. |
| **Training review** | Enable training approvals. |
| **Evaluations** | Enable held-out approvals and automatic evaluation runs. |
| **Enable learning** | Master switch for history, datasets, and knowledge. |

Knowledge has separate switches on this page. It can be used without training-data collection. The master switch pauses all these workflows while preserving data and choices; an in-flight model request may finish.

## Review examples

Open **Training** in the header when training review is enabled.

| Decision | Meaning |
| --- | --- |
| **Teach the agent** | Approve training data. No fine-tuning request is sent. |
| **Test the agent** | Reserve a held-out example for evaluation; may queue model calls when evaluations are enabled. |

Evaluation needs independent ground truth: expected files, symbols, a dependency path, a reproducible test, or a reviewed answer. An answer's own citations are proposed evidence, not proof.

Codeberg checks related question and evidence-file families when separating training from evaluation. Keep evaluation families held out. Changed feedback can invalidate approval; review the current revision before exporting again.

## Export data

Commands write local JSONL and print their paths:

```sh
codeberg learning export --type query-positive-negative
codeberg learning export --type openai-chat
codeberg learning export --type preference
codeberg learning export --type eval
```

The CLI uses the saved default project unless internal keyed roots are supplied. A browser tab's project selection does not change that default. Training exports need current approvals and can be empty before review.

| Type | Output |
| --- | --- |
| `embedding`, `query-positive-negative` | Retrieval examples; the latter includes query, positive source, and reviewed negative source. |
| `openai-chat` | Approved solved standalone user/assistant pairs. Full trajectories stay in source records. |
| `preference` | Chosen/rejected pairs for the exact same question and interaction. |
| `eval` | Current held-out examples and reviewed oracles. |
| `knowledge` | Versioned knowledge artifacts for offline review or indexing. |

For automatic evaluations and external model comparisons, see [Evaluations](/docs/evaluations).

## Build an RL environment

Codeberg derives RLVR candidates (reinforcement learning with verifiable rewards): tasks, provenance, tools, successful trajectories, and proposed verifiers/rewards. Verifiers require review; recorded test output alone does not establish that a check can be rerun.

An external runner still needs:

| Piece | Required work |
| --- | --- |
| Reset | Restore the pinned commit, dependencies, fixtures, indexes, and per-episode state. |
| Actions | Define tools, observations, permissions, and resource limits. |
| Reward | Validate an independent oracle or tests; define success and investigation costs. |
| Evaluation | Set episode budgets and keep task families held out. |

For a route-tracing task, an oracle might specify the required files, symbols, and dependency path at a pinned commit. A runner checks the answer's evidence and records cost.

There is no dedicated `--type rlvr` export or built-in RL trainer. Candidates and payloads are available in training review and local dataset records.

## Costs and cleanup

Recording history and deriving candidates use no model calls. Training approval starts no training. Automatic evaluations use chat/learning models and appear under learning usage; external training has its own compute costs.

To disable the subsystem, save `CODEBERG_LEARNING_USE=false` and restart. Existing data remains. Index-only deletion retains it; full project-history deletion removes learning and knowledge. See [Data and maintenance](/docs/storage).
