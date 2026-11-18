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

## When findings are saved

Rate an answer **Solved** or **Mostly correct** to save what it found. **Mostly correct** findings are capped at medium confidence, and a rating reason that disputes a claim keeps it out. **Partially useful** and **Not useful** save nothing.

A finding is kept only when it can be quoted from current source. If the agent answered without reading the relevant files, nothing is saved; ask it to open the files, then rate again.

## How you work

**Learn how you work** keeps short notes about your preferences, separate from codebase findings:

| Kind | Example |
| --- | --- |
| Preference | Prefers tables over prose. |
| Workflow | Runs the tests before committing. |
| Convention | Uses pnpm, not npm. |
| Context | Works mainly on the billing service. |

After each answer and each rating, the learning model reads your messages and rating reasons and updates the notes. No rating is needed. Every note quotes your own words, so state preferences plainly in a message or a rating reason, for example `keep answers short and cite file paths`. The 24 newest notes are added to each new chat; at most 40 are kept. When the switch is first on, your 10 most recent saved questions are read once.

Notes need **Record chats and feedback** and a learning model. Turn the switch off to stop both learning and using notes; saved notes are kept.

## See what is saved

**Settings → Learning → Saved memory** lists your work-style notes and saved codebase findings, with their status. Select **Remove** to delete a note you disagree with. The panel also shows saves that are still running and any errors, such as a missing learning model.

## Choose what runs

Open **Settings → Learning** for the selected project.

| Control | Purpose |
| --- | --- |
| **Learn how you work** | Learn and use your work-style preferences. |
| **Codebase knowledge** | Enable the knowledge capability. |
| **Use knowledge in chats** | Recall saved findings. |
| **Learn from confirmed answers** | Extract new findings when you rate an answer **Solved** or **Mostly correct**. |
| **Automatic source refresh** | Update findings when relevant source changes. |
| **Daily knowledge consolidation** | Propose combined or improved explanations; off by default. |

Expand categories to choose what is collected or recalled. Disabling a category retains its files.

For recall without new background knowledge calls, keep **Codebase knowledge** and **Use knowledge in chats** on, and extraction, refresh, consolidation, and **Learn how you work** off. **Record chats and feedback** and dataset capture can stay off.

> **Enable learning** is the shared master switch. Turning it off pauses knowledge, history, and dataset work while retaining data and individual choices. An in-flight model request may finish.

## Review consolidation

Generate a report in Settings. Inspect before-and-after notes and preserved sources, then **Apply** or **Dismiss**. Applied reports offer **Undo**.

Invalid suggestions from the learning model, such as unknown note IDs or merges across categories, are left out of the report rather than failing it. A merge that would lose a claim or whose evidence no longer matches the code becomes a link. A report fails only when the model returns no JSON at all; check the learning model in **Models** and generate again.

Consolidation changes saved explanations. Source refresh rechecks evidence; neither trains the model. Extraction, refresh, and consolidation use the learning model selected in **Models**.

## Costs and persistence

Background knowledge and work-style learning consume model tokens; learning how you work makes one call per answer and per rating. Recall and work-style notes add context to chat calls. Check **Settings → Usage**.

Deleting only indexes retains knowledge. Deleting the project's entire history removes it. `CODEBERG_LEARNING_USE=false` disables the encompassing subsystem after restart and keeps stored data. See [Data and maintenance](/docs/storage).
