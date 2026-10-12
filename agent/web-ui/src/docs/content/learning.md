Codeberg can retain useful knowledge from investigations and recall prior work. Learning is project-specific, so knowledge from one repository does not silently become another project's history.

## What is saved

Learning history records interactions and feedback. Codebase knowledge stores reusable explanations of services, flows, concepts, and debugging findings. Dataset capture records examples for training review and evaluations. These are separate controls; collecting an example does not automatically train or fine-tune a model.

Background extraction and refresh can call the learning model selected in **Models**. Saved evidence still needs verification when source changes. Knowledge is an aid to investigation, not a replacement for reading current source.

## Control background work

Open **Settings → Learning** for the selected project. **Enable learning** pauses collection, recall, and background jobs while retaining stored data and individual choices. A model request already running may finish.

For recall without new background knowledge calls, leave **Codebase knowledge** and **Use knowledge in chats** enabled, then disable **Learn from solved answers**, **Automatic source refresh**, and **Daily knowledge consolidation**. Historical recall can stay enabled while **Record chats and feedback** is disabled.

Expand knowledge categories and example types to control which material is collected or recalled. Disabling a category or capture type preserves previously saved files. Training review and evaluation switches control new reviewed approvals; evaluations are held-out data, not automatic model runs.

## Review consolidation and examples

Knowledge consolidation proposes changes that combine or improve saved explanations. Generate a report in Learning settings, inspect before-and-after notes and preserved sources, then apply or dismiss it. Daily proposals are optional and off by default. Applied reports offer Undo.

When training review is enabled, **Training** in the header opens captured examples for review. Approving an example prepares local dataset material; it does not send a fine-tuning request to a provider.

## Understand costs and persistence

Recording local history and explicit review do not themselves call a model. Extraction, refresh, and consolidation can use model tokens; recalled content also adds context to later chat requests. Inspect **Settings → Usage** for recorded chat and learning requests.

Set `CODEBERG_LEARNING_USE=false` in the launcher config to disable the learning subsystem, then restart. Existing data remains available for later reuse. Deleting a project's entire history removes its saved learning and knowledge; deleting only indexes retains them. See [Data and maintenance](/docs/storage) before cleanup.
