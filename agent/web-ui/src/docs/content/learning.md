The main goal of **Learning** is to turn real codebase investigations into reviewed data for **post-training custom embedding models and LLMs**. Post-training adapts an existing model using task-specific examples, preferences, or reward signals. The same records can provide the foundation for reproducible **reinforcement-learning (RL) environments**.

[Knowledge](/docs/knowledge) has a separate purpose: improving the agent's answers as Codeberg accumulates useful findings from use. This page covers training-data collection, review, export, and evaluation. Records and settings are project-specific.

## Why collect this data

A useful investigation contains more than a final answer: the question, searches, relevant source, tool calls, corrections, and evidence that the task was solved. Keeping these together makes it possible to improve both retrieval and the agent's behavior on your domain.

| Training goal | Useful data | What a custom model could learn |
| --- | --- | --- |
| **Embedding model or reranker** | Queries, relevant source chunks, and reviewed hard negatives | Retrieve the right code for your terminology, architecture, and recurring questions. |
| **Supervised LLM post-training** | Solved answers and successful tool trajectories | Investigate a codebase, choose tools, and produce grounded explanations. |
| **Preference tuning** | Reviewed chosen and rejected answers for the same question | Favor useful, correct responses over failed or misleading attempts. |
| **Reinforcement learning** | Tasks, repository versions, tool observations, and verifiable outcomes | Complete investigations through a sequence of actions, with rewards tied to task success. |

A **hard negative** is a plausible retrieval result that has been reviewed as irrelevant to the task. Simply retrieving a file and leaving it uncited does not make it a negative example.

> **Collection and training are separate steps.** Codeberg currently records, derives, reviews, and exports data. Model weight updates, training jobs, and executable RL environment runners happen outside the app.

## What is saved

Learning history records interactions and feedback. Dataset capture derives retrieval, supervised fine-tuning (**SFT**), preference, hard-negative, and RL task candidates. Capture, training approval, and evaluation have separate controls.

Recorded attempts can include ordered tool calls and observations, retrieved results, files and symbols inspected, cited evidence, repository commits, and available model, token, and timing metadata. Private model reasoning is excluded. A recorded commit identifies the source version; it does not package a complete runnable environment.

## Control background work

Open **Settings → Learning** for the selected project. **Record chats and feedback** controls interaction capture. **Dataset capture** and its example types control dataset collection. **Training review** and **Evaluations** control new reviewed approvals; evaluations are held-out data, not automatic model runs.

Knowledge has its own switches on the same settings page. You can use accumulated knowledge without enabling training-data collection. The master **Enable learning** switch currently pauses knowledge, history, and dataset work together while retaining stored data and individual choices. A model request already running may finish.

## Review training and evaluation examples

When training review is enabled, **Training** in the header opens captured examples for review. Approving an example prepares local dataset material; it does not send a fine-tuning request to a provider.

Choose **Teach the agent** for training data or **Test the agent** for a held-out evaluation example. Evaluation needs independently reviewed ground truth, such as expected source files, symbols, a dependency path, or a reproducible test. An answer's own citations are proposed evidence rather than an automatic correctness check.

Codeberg checks related question and evidence-file families when separating training from evaluation. Keep the evaluation set reserved for measuring new models. Revised feedback can make an earlier approval outdated; review the current candidate revision before exporting it again.

## Build toward proper RL environments

An RL environment lets a model attempt a task repeatedly: receive a question, take an action, observe the result, and eventually receive a reward. For a codebase agent, actions might be searching source, reading a file, tracing references, or answering with evidence.

Codeberg can already derive **RLVR** candidates—reinforcement learning with verifiable rewards—with a task, repository provenance, available and observed tools, successful trajectories, and proposed verifier or reward components. Proposed verifiers are marked for review; a tool's recorded test output alone does not prove that the check can be rerun reliably.

To turn a reviewed candidate into an executable environment, an external runner needs these pieces:

| Environment piece | What it needs |
| --- | --- |
| **Reset and initial state** | Restore the pinned repository commit, dependencies, fixtures, and compatible indexes; reset per-episode state so attempts start under the same conditions. |
| **Actions and observations** | Expose a defined set of tools and their outputs, with explicit permissions and resource limits. Recorded calls help specify and test this interface. |
| **Verifier and reward** | Run reviewed tests or compare results against an independent source oracle. Define success and any tool, token, or latency costs explicitly. |
| **Episode end and evaluation** | Decide when a task succeeds, fails, or reaches its budget. Keep held-out task families separate from training episodes. |

For example, a task could ask, “Trace how this HTTP route reaches its database query.” The environment starts from a specific commit and gives the model source-search tools. A reviewed oracle identifies the required files, symbols, and dependency path. The runner can check the submitted evidence and score task success, while also recording the cost of the investigation.

This is the path from everyday usage to custom retrieval training, tool-using LLM post-training, and verifiable RL tasks. The captured records are the starting material; environment construction, verifier validation, and the training loop are additional work.

## Export and compare models

After reviewing examples, the terminal export commands write local JSONL files and print their paths:

```sh
codeberg learning export --type query-positive-negative
codeberg learning export --type openai-chat
codeberg learning export --type preference
codeberg learning export --type eval
```

Run these against the intended project, for example with its `CODEBERG_ROOT` exported. Training exports require current approved examples of the corresponding kind; they can be empty before review.

| Export type | Intended use |
| --- | --- |
| `embedding`, `query-positive-negative` | Retrieval training examples. The latter projects query, positive source text, and reviewed negative source text. |
| `openai-chat` | User/assistant message pairs from approved, solved standalone turns for supervised training. Full tool trajectories remain in the source records. |
| `preference` | Chosen/rejected answer pairs for the same interaction and exact question. Inspect their context before tuning. |
| `eval` | Current reviewed held-out examples, including their oracles. |
| `knowledge` | Versioned knowledge artifacts for offline indexing or review. |

There is currently no dedicated `--type rlvr` export or built-in RL trainer. RL candidates and their payloads are available through training review and the local dataset records.

`codeberg learning metrics` scores historical attempts against reviewed evaluation oracles. To compare an embedding model, reranker, or agent, run it externally on the same held-out tasks, then use `codeberg learning score runs.jsonl` to score its submitted results. Reports include retrieval recall, source and symbol hits, task success, tool calls, tokens, and latency; these commands score recorded runs rather than execute a model.

The custom embedding model and chat LLM have separate roles and runtime requirements. See [Indexing and search](/docs/indexing) and [Models and credentials](/docs/models) when configuring a trained model for use.

## Understand costs and persistence

Recording local history, deriving dataset candidates, and explicit review do not themselves call a model. External post-training and evaluation runs have their own compute and provider costs. The separate knowledge workflow can make background model calls; see [Knowledge](/docs/knowledge) for its controls and costs.

Set `CODEBERG_LEARNING_USE=false` in the launcher config to disable the learning subsystem, then restart. Existing data remains available for later reuse. Deleting a project's entire history removes its saved learning and knowledge; deleting only indexes retains them. See [Data and maintenance](/docs/storage) before cleanup.
