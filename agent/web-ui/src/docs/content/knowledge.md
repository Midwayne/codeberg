Knowledge is project-specific and works through chat context, without updating model weights.

[Learning](/docs/learning) separately collects reviewed data for custom model training and evaluation.

## What knowledge keeps

| Category | Example |
| --- | --- |
| Services | How authentication is organized. |
| Flows | How checkout reaches a payment provider. |
| Concepts | What a domain-specific state means. |
| Debugging findings | Why a retry failed and which source explains it. |
| Procedures | How to find live orders: which tables to join, which tool to call, and which rows to skip. |

Findings retain source references and provenance. Later questions can build on confirmed investigations, but the agent should still check the current source. Raw attempts, corrections, and feedback live separately in learning history.

## When findings are saved

Rate an answer **Solved** to save it. The learning model turns it into claims quoted from current source, using the files the answer names and the files the agent read or searched.

| Rating | What is saved |
| --- | --- |
| **Solved** | Source-quoted claims, plus a [procedure](#teach-codeberg-a-procedure) when the chat taught one. If neither can be saved, the answer itself is kept as a low-confidence **confirmed answer**, marked not source-verified. |
| **Mostly correct** | Source-quoted claims capped at medium confidence, and taught procedures. A rating reason that disputes a claim or step keeps it out. |
| **Partially useful**, **Not useful** | Nothing. Lowering a rating withdraws what was saved from that answer. |

A later answer that can be quoted replaces its confirmed answer. Chats still treat confirmed answers as unverified and check current code before relying on them.

## Teach Codeberg a procedure

A procedure is a way of getting something done that you show the agent, such as a series of tool calls, a database query with specific joins, or an MCP sequence. It need not appear in the code.

1. In a chat, walk the agent through the task. Tell it which tools to use, correct its queries, and state any rules, for example `always skip deleted customers`.
2. When the result is right, rate the final answer **Solved**, or **Mostly correct** with a reason for what to change.
3. The learning model reads that chat up to the rated answer and saves the procedure under **Procedures**.

Each saved step either reuses a tool call the agent actually made, with its recorded input such as the SQL, or quotes your own words. Steps it cannot tie to either are dropped. Teaching the same task again in a later chat updates the existing procedure instead of adding another.

Procedures are listed first in each new chat's knowledge index, and the agent is told to follow a matching one, adapting inputs to the request. Because they are not tied to source files, code changes do not hide them. Lowering the rating withdraws one. A procedure replaces the plain confirmed answer for the same rating.

Turn off the **Procedures** category to stop learning and using them. The learning model reads at most the last 8 messages and 40 tool calls of the chat, so teach one task per chat.

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

## Memory settings

Open **Settings → Learning** for the selected project. Every memory switch is listed here, including the history switches that memory depends on.

| Switch | What it does | Needs | Cost |
| --- | --- | --- | --- |
| **Enable learning** | Master switch. Off pauses all memory, history, and dataset work; data and individual choices are kept. | — | — |
| **Learn how you work** | Learn your work-style notes and add them to new chats. | Record chats and feedback, a learning model | One call per answer and per rating; adds chat context |
| **Codebase knowledge** | Turn the knowledge capability on or off. Off also disables the switches under it. | — | — |
| **Learn from confirmed answers** | Save findings and procedures when you rate an answer **Solved** or **Mostly correct**; see [When findings are saved](#when-findings-are-saved). | Record chats and feedback, a learning model | Up to two calls per confirming rating |
| **Use knowledge in chats** | Add up to 24 finding titles to each chat and let the agent search saved findings. | — | Adds chat context |
| **Automatic source refresh** | Recheck findings when their cited files change. | A learning model | One call per changed finding |
| **Daily knowledge consolidation** | Generate one reviewable report a day; off by default. Manual reports work without it. | A learning model | One call per report |
| **Knowledge categories** | Choose which categories are saved and recalled, including **Procedures**. Turning one off keeps its files. | — | — |
| **Learning history** | Turn local history of earlier investigations on or off. | — | — |
| **Record chats and feedback** | Save answers, tool results, and ratings. Ratings and all memory learning need it. | — | Disk only |
| **Use history in chats** | Let the agent search earlier attempts and corrections. | — | Adds chat context |

Choose the learning model in **Models**. Without one, saved memory is still used in chats, but nothing new is learned. An in-flight model request may finish after a switch is turned off.

### Common setups

| Goal | Turn on | Turn off |
| --- | --- | --- |
| Learn as much as possible | All except daily consolidation | — |
| Use what is saved, no new background calls | **Codebase knowledge**, **Use knowledge in chats** | **Learn how you work**, **Learn from confirmed answers**, **Automatic source refresh**, **Daily knowledge consolidation** |
| Codebase findings only, no personal notes | Knowledge switches, **Record chats and feedback** | **Learn how you work** |
| Nothing new saved | — | **Record chats and feedback** |

`CODEBERG_LEARNING_USE=false` disables the whole subsystem after restart and keeps stored data. See [Environment variables](/docs/environment).

## Keep knowledge current

Each finding stores its cited files, their content hashes, and the repository commit.

1. When a cited file changes, the finding is hidden from chats immediately. Commits that leave the cited files unchanged do not affect it.
2. With **Automatic source refresh** on, the learning model rereads the current files and rewrites the finding from claims it can quote. Disproven claims are dropped.
3. If the new code cannot confirm it, the finding stays **needs verification** and out of chats until its files return or a new confirmed answer repairs it.
4. A later **Solved** or **Mostly correct** answer on the same topic replaces the finding's claims instead of adding a duplicate.
5. Lowering a rating to **Partially useful** or **Not useful** withdraws findings learned from that answer.

Refresh only follows cited files. If behavior moved to a file the finding never quoted, ask the question again and rate the new answer. A confirmed answer that consulted no files changes only with its rating. One whose files change is hidden and is not re-saved from the old answer; rate a new answer to replace it. Work-style notes are not tied to source: they change only when you state a new preference, contradict an old one, or select **Remove**.

## Why an answer was not saved

A **Solved** answer is almost always saved, at least as a confirmed answer. It can still be skipped when:

| Cause | What to do |
| --- | --- |
| You rated an earlier answer, but a newer retry in the same question is unrated or rated lower. | Rate the latest answer. |
| The answer already produced a finding that later went stale. The old answer is not re-saved over it. | Ask again and rate the new answer. |
| No learning model, **Learn from confirmed answers** is off, or every category is off. | Check **Models** and **Settings → Learning**. |
| The learning model request failed. | The panel shows the error; the job retries automatically. |

A **Mostly correct** answer is skipped when no claim can be quoted from the files the agent consulted, or the source did not fit the learning model's context. A stronger learning model with a larger context window quotes more reliably.

The **Saved memory** panel shows queued saves and model errors. Skipped saves appear only in the trace log, `projects/<id>/logs/learning-agent-trace.log` under Codeberg home. Search it for `extraction_skipped` and read `reason`:

| `reason` | Meaning |
| --- | --- |
| `no_current_source_evidence` | No consulted source file could be read. A Solved answer is kept as a confirmed answer. |
| `latest_attempt_not_confirmed` | The latest answer is not rated **Solved** or **Mostly correct**. |
| `model_returned_none` | The model declined; `model_reason` says why. A Solved answer is kept as a confirmed answer. |
| `claims_not_grounded` | No claim's quote matched current code, even ignoring whitespace. A Solved answer is kept as a confirmed answer. |
| `own_artifacts_already_current` | The findings from this answer are already up to date. |

A `confirmed_answer_saved` entry means a Solved answer was kept without quoted claims. `procedure_saved` means a procedure was saved; `procedure_skipped` shows the model's raw reply when no step could be tied to a tool call or your words.

`model_response` entries show the learning model's raw output. Remove private source before sharing the log.

## Review consolidation

Generate a report in Settings. Inspect before-and-after notes and preserved sources, then **Apply** or **Dismiss**. Applied reports offer **Undo**.

Invalid suggestions from the learning model, such as unknown note IDs or merges across categories, are left out of the report rather than failing it. A merge that would lose a claim or whose evidence no longer matches the code becomes a link. A report fails only when the model returns no JSON at all; check the learning model in **Models** and generate again.

Consolidation changes saved explanations. Source refresh rechecks evidence; neither trains the model. Extraction, refresh, and consolidation use the learning model selected in **Models**.

## Costs and persistence

Background knowledge and work-style learning consume model tokens; learning how you work makes one call per answer and per rating. Recall and work-style notes add context to chat calls. Check **Settings → Usage**.

Deleting only indexes retains knowledge and work-style notes. Deleting the project's entire history removes both. See [Data and maintenance](/docs/storage).
