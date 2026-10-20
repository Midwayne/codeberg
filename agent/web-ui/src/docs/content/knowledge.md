**Knowledge helps the agent answer better as Codeberg is used more.** Useful findings from solved investigations become reusable, source-backed explanations. Later questions can draw on that accumulated understanding of your codebase, so the agent can build on what has already been established.

**Learning** has a separate goal: collecting reviewed data for post-training custom embedding models and LLMs, and building RL environments. See [Learning](/docs/learning) for that workflow.

## How knowledge improves answers

A solved investigation might establish how a service works, why a request takes a particular path, or what caused a bug. Codeberg can retain that explanation with its source evidence and recall it when another question covers the same area.

For example, after you confirm an explanation of a checkout flow, a later question about its retry behavior can start from the saved understanding of that flow. The agent still checks the relevant source, but it has useful context from previous work instead of relying only on the current conversation.

Knowledge is project-specific. Findings from one repository do not silently become another project's knowledge. Its usefulness depends on the quality of confirmed investigations and keeping their evidence current.

> **Knowledge works through context.** Recalled findings help the running agent answer questions. Using knowledge does not require a training export or a model weight update.

## What is saved

Codebase knowledge stores reusable explanations of **services**, **flows**, **concepts**, and **debugging findings**. Artifacts retain source references and provenance so findings can be checked against the code they describe.

Learning history separately retains raw attempts, corrections, and feedback. The agent can recall that history as well as distilled knowledge. Training examples have their own capture and review controls; they are covered in [Learning](/docs/learning).

## Control knowledge

Open **Settings → Learning** for the selected project. Knowledge and training-data controls currently share this settings page, while their purposes and switches are separate.

- **Codebase knowledge** enables the knowledge capability.
- **Use knowledge in chats** controls whether saved findings can be recalled.
- **Learn from solved answers** controls new knowledge extraction from confirmed solutions.
- **Automatic source refresh** controls background updates when relevant source changes.
- **Daily knowledge consolidation** controls optional daily proposals for combining or improving saved explanations; it is off by default.

Expand knowledge categories to choose which material is collected or recalled. Disabling a category preserves its saved files.

For recall without new background knowledge calls, leave **Codebase knowledge** and **Use knowledge in chats** enabled, and disable extraction, refresh, and daily consolidation. Knowledge recall can stay available while **Record chats and feedback** is disabled. Dataset capture and training review are separate choices.

The page's master **Enable learning** switch pauses knowledge, history, and dataset work together while retaining stored data and individual choices. A model request already running may finish.

## Keep findings current

Code changes can make an earlier explanation outdated. Saved knowledge retains evidence that can be rechecked; background extraction and refresh use the learning model selected in **Models**. The agent should verify recalled findings against current source when answering.

Source checks reuse a bounded local memory cache to avoid rereading and hashing unchanged files. Every observation still checks the file's identity, size, and modification/change timestamps, and cached contents are reread after five minutes. The cache holds at most 256 files with an estimated 8 MiB text budget. It does not change knowledge capture, refresh, or training-data settings.

Knowledge consolidation proposes changes that combine or improve saved explanations. Generate a report in Settings, inspect before-and-after notes and preserved sources, then apply or dismiss it. Applied reports offer Undo. Consolidation updates saved knowledge rather than training the model.

## Costs and persistence

Extraction, refresh, and consolidation can use model tokens. Recalled knowledge adds context to chat requests. Inspect **Settings → Usage** for recorded requests.

Deleting only a project's indexes retains its history and knowledge. Deleting the project's entire history removes its saved knowledge as well. The global `CODEBERG_LEARNING_USE=false` switch disables the encompassing subsystem, including knowledge; existing stored data remains on disk. See [Data and maintenance](/docs/storage) before cleanup.
