Start with [Learning](/docs/learning) to capture candidates and approve **Test the agent** examples with independent ground truth.

## Automatic evaluations

Enable **Enable learning**, **Dataset capture**, and **Evaluations** in **Settings → Learning**. Configure both chat and learning models in **Models**.

Approving a test example queues an evaluation. Codeberg also scans on startup and every two minutes. Model changes queue new comparisons; matching completed runs are reused across scans and restarts.

| Stage | Behavior |
| --- | --- |
| Retrieve | Search the current project's index for up to ten passages. |
| Answer | Ask the selected chat model for a fresh answer. |
| Judge | Use the learning model to score the output independently. |
| Record | Save metrics and task, commit, model, effort, and rubric provenance. |

This read-only baseline excludes historical answers, reviewed references, history recall, and knowledge recall from answer generation. It does not run the full interactive agent or an RL environment. Commit mismatches are skipped; Codeberg does not restore repositories or isolate uncommitted edits.

Inspect results:

```sh
codeberg learning eval-reports
```

The project API also exposes `/api/learning/evaluations`. Statuses include completed, retrying, failed, superseded, and skipped. Feedback/model/repository changes invalidate in-flight comparisons; saved output and scores let retries reuse completed calls.

One task runs at a time. Each model request is limited to **2,048 output tokens** and **two minutes**. Oversized judge evidence fails explicitly. Transient errors retry with backoff for at most five attempts.

Turning off any required switch pauses new work; an in-flight request can finish. Automatic calls cost provider tokens and appear under learning usage. Calibrate judge scores against human review before using them as release gates.

## Score retrieval runs

```sh
codeberg learning metrics
codeberg learning score runs.jsonl
```

`metrics` scores historical attempts against reviewed oracles. `score` scores results submitted by an external model or agent. Reports cover retrieval recall, file/symbol hits, task success, tools, tokens, and latency. These commands score recorded runs rather than execute a model.

## Score candidate outputs

Add an independent `expected` value to the reviewed oracle. For JSON, optionally add `"output_format":"json"`; for example:

```json
{"expected":"3","output_format":"json"}
```

Retrieval examples also need their file, repository, symbol, or dependency-path oracle. Solved ratings and recorded answers are not substituted for ground truth.

Each line of `runs.jsonl` supplies an exported eval ID and candidate output. Model and actual retrieved context are optional:

```json
{"eval_id":"example-...","output":"3","model":"candidate-v1","context":["The function returns 3."]}
```

```sh
codeberg learning score-outputs runs.jsonl
```

| Default metric | Checks |
| --- | --- |
| `exact_match` | Literal equality, ignoring object key order. Strings and objects differ. |
| `valid_json` | JSON syntax when requested by the oracle; not schema validation. |

Neither metric judges the meaning of prose.

## Add a model judge

Select a configured provider and model explicitly:

```sh
codeberg learning score-outputs runs.jsonl --judge provider:model
```

This sends the question, candidate output, and applicable reference/context to the provider and incurs costs.

| Metric | Compares |
| --- | --- |
| Factuality | Candidate claims against the reviewed expected answer. |
| Faithfulness | Claims against context actually given to the candidate. Context support does not establish truth. |

Versioned rubrics return 0, 0.5, or 1 with a short explanation. Judge scores do not approve training data automatically.

## Compare reports

Keep the same task IDs and pinned candidate/judge models. Reports retain dataset revisions, commits, model labels, and rubric versions; scoring does not rerun candidates or restore repositories.

Each metric has a mean and scored/skipped/error counts. Missing reference or context skips the affected check. Provider or malformed-response errors are separate and cause a nonzero CLI exit. Missing runs are listed and excluded from means; compare coverage as well as quality. Unknown or duplicate IDs are rejected.
