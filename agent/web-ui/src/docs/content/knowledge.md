Knowledge is project-specific and works through chat context, without updating model weights.

[Learning](/docs/learning) separately collects reviewed data for custom model training and evaluation.

## What knowledge keeps

| Category | Example |
| --- | --- |
| Services | How authentication is organized. |
| Flows | How checkout reaches a payment provider. |
| Concepts | What a domain-specific state means. |
| Debugging findings | Why a retry failed and which source explains it. |

Findings retain source references and provenance. Later questions can build on confirmed investigations, but the agent should still check the current source. Raw attempts, corrections, and feedback live separately in learning history.

## Choose what runs

Open **Settings → Learning** for the selected project.

| Control | Purpose |
| --- | --- |
| **Codebase knowledge** | Enable the knowledge capability. |
| **Use knowledge in chats** | Recall saved findings. |
| **Learn from solved answers** | Extract new findings from confirmed solutions. |
| **Automatic source refresh** | Update findings when relevant source changes. |
| **Daily knowledge consolidation** | Propose combined or improved explanations; off by default. |

Expand categories to choose what is collected or recalled. Disabling a category retains its files.

For recall without new background knowledge calls, keep the first two controls on and extraction, refresh, and consolidation off. **Record chats and feedback** and dataset capture can stay off.

> **Enable learning** is the shared master switch. Turning it off pauses knowledge, history, and dataset work while retaining data and individual choices. An in-flight model request may finish.

## Review consolidation

Generate a report in Settings. Inspect before-and-after notes and preserved sources, then **Apply** or **Dismiss**. Applied reports offer **Undo**.

Consolidation changes saved explanations. Source refresh rechecks evidence; neither trains the model. Extraction, refresh, and consolidation use the learning model selected in **Models**.

## Costs and persistence

Background knowledge work can consume model tokens; recall adds context to chat calls. Check **Settings → Usage**.

Deleting only indexes retains knowledge. Deleting the project's entire history removes it. `CODEBERG_LEARNING_USE=false` disables the encompassing subsystem after restart and keeps stored data. See [Data and maintenance](/docs/storage).
