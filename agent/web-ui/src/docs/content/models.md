Chat models produce answers. Learning models perform background knowledge work. Embedding models turn source chunks into vectors for search. Configuring one does not configure the others.

For semantic search, new installations use **EmbeddingGemma 2** with its text encoder only, in **FP32**: MLX on Apple Silicon, Sentence Transformers elsewhere. Qwen variants and Jina remain selectable, and existing model selections are kept. Embedding selection is configured through `CODEBERG_EMBEDDING_MODEL` or the launcher's `--embedding` flag. See [Indexing and search](/docs/indexing) for runtime prerequisites and how to switch models.

## Choose a provider

Set the model as `provider:model` and supply the matching credential through the launcher config or process environment.

| Provider | Model setting | Credential or endpoint |
| --- | --- | --- |
| OpenAI | `openai:your-model-name` | `OPENAI_API_KEY` |
| Anthropic | `anthropic:your-model-name` | `ANTHROPIC_API_KEY` |
| Google | `google:your-model-name` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Ollama | `ollama:your-model-name` | `OLLAMA_BASE_URL`, default `http://localhost:11434/v1` |
| llama.cpp | `llamacpp:your-model-label` | `LLAMACPP_BASE_URL`, default `http://localhost:8080/v1` |

Local providers use the OpenAI-compatible Chat Completions API. Start their server and load the model separately. For llama.cpp, the server's loaded model determines the actual model; the label is a name for that connection. The local server must support the agent's tool calls.

When embedding the TypeScript agent, `AgentOptions.model` accepts an AI SDK model instance or a string model ID such as `openai/gpt-4o`. String IDs use the SDK's configured default provider, falling back to its gateway, and retain Codeberg's context budgeting. These SDK IDs are separate from the launcher's `provider:model` settings above.

Use `codeberg config edit` to enter credentials privately. To change a non-secret model setting:

```sh
codeberg config set CODEBERG_MODEL=openai:your-model-name
```

Restart after changing provider credentials or the launcher config. A cloud provider without its API key is not available to the agent. The documentation remains accessible so you can finish setup.

## Add a model catalog

To offer several choices, create `models.yml` inside your Codeberg home, normally `~/.codeberg/models.yml`. This example uses an illustrative model name and context window; replace them with values supported by your provider:

```yaml
providers:
  openai:
    models:
      everyday:
        model: gpt-4o
        label: Everyday chat
        context_window: 128000
        efforts: [provider-default]
        inputs: [text, vision]
```

`everyday` is the catalog key; `gpt-4o` is the model name sent to the provider. The saved selection is `openai:everyday`. Different keys may use the same provider model with different windows or effort lists. Omit `model` only when the key itself is the provider model name.

Every entry needs an integer `context_window` of at least 1,024 and a nonempty `efforts` list. Only list efforts the model and endpoint support: `provider-default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. `max` is limited to supported OpenAI Responses-compatible providers. The window controls how Codeberg trims and summarizes context; setting it too large can cause provider errors.

`inputs` defaults to `[text]`. Add `vision`, `audio`, `video`, or `pdf` only when both the model and its API accept them. Attachments are limited to 20 MB per file; switching models must preserve support for attachments already in the conversation. Credentials belong in the environment or config, never in `models.yml`.

[Browser Use](/docs/tools#browser-use-delegation) only starts sessions with a browser model declared to accept `vision`, even when its screenshot toggle is off. The example above declares that capability. Without a catalog, models are treated as text-only and cannot start browser sessions. The separate **Settings → Tools → Browser vision** toggle controls whether Browser Use sends screenshots on its next task; it does not declare or change a model's capabilities.

## Select models in the app

Open **Models** in the header. Choose the chat model and effort, then the learning model and effort, and save. Changes affect new chat turns and new background jobs; work already running retains its selection. Choices persist across restarts and tabs.

Without a catalog, choices come from `CODEBERG_MODEL` and optional `CODEBERG_SUBAGENT_MODEL`. The learning model defaults to the chat model. With a valid catalog, `CODEBERG_MODEL` can be omitted. Catalog changes are read when settings are requested; provider credential changes require a restart.

## How chat context stays bounded

Codeberg keeps stable system instructions and tool ordering so providers can reuse prompt caches where supported. MCP tool schemas load on demand. Cache availability and billing depend on the provider.

Before summarizing a long conversation, Codeberg moves tool results larger than 12,000 characters into local context files. The model receives a preview and a path it can search or read. If that makes the conversation fit, no summary call is needed.

When history still exceeds its budget, older exchanges become a concise checkpoint covering the objective, requirements, decisions, findings, unresolved work, and next steps. Recent exchanges target 25% of the history budget, up to 15,000 estimated tokens. Tool calls and their results stay together. During a long investigation, earlier completed tool steps can also be archived while the current user request and newest complete tool step remain available.

Checkpoints are saved under the project's `context/checkpoints/` directory. Follow-ups and resumed chats reuse a checkpoint when the earlier messages and model/summary policy match, avoiding another summary of the same prefix. Edited history, a different model policy, missing archives, or corrupt checkpoint files cause Codeberg to rebuild it from the original conversation.

Every model request is also checked with its system instructions, active tool schemas, and attachment estimates included. Compatible provider-reported input counts calibrate later requests in the same conversation; cache tokens are counted once. By default, chat output is capped at 8,192 tokens or 15% of the working window, whichever is smaller, with another 15% kept as an estimation margin. Models with working windows of 16,384 tokens or less receive concise instructions with the same database consent rules and full tool schemas.

For Anthropic models with budget-based thinking, the SDK adds thinking tokens to the answer limit. Codeberg reserves that full completion allocation before fitting history, including explicit thinking budgets and the provider's output cap. Adaptive thinking shares the existing output reservation. High reasoning effort can therefore leave less room for history; if the completion allocation alone cannot fit, lower the effort or use a larger working window.

Summary input is sized to the summarizer's own window, including its instructions and reply space. Summary output is capped at 25% of the chat history budget, 15% of the summarizer's working window, or 2,000 tokens, whichever is smallest. Empty or truncated summaries are rejected; an archive reference lets the agent recover the original text instead of relying on an incomplete checkpoint.

For a provider context-limit rejection, Codeberg can make up to three smaller retries of that model request. Completed local tool calls are retained and are not replayed by recovery. Browser streams can recover before generated text, reasoning, or tool-call content starts; errors after output starts are returned to the caller. Authentication, rate-limit, and cancellation errors do not trigger context recovery.

Older text transcripts and spilled outputs remain in the project's `context/` directory, so the agent can recover details omitted by a summary. These files can contain source and conversation data; see [Storage and privacy](/docs/storage). Text estimates use roughly four characters per token, and media estimates are approximate. The current request, instructions, or schemas can still exceed a model's window; Codeberg reports this instead of discarding the current request. Narrow attachments, reduce integrations, or use a larger model window if this happens.

For direct component runs, `CODEBERG_CONTEXT_WINDOW` sets the chat window and `CODEBERG_CONTEXT_BUDGET` caps the working window (default 200,000 tokens, never above the model window). The history budget is half the working window. When a different `CODEBERG_SUBAGENT_MODEL` summarizes history, its window is inferred separately; `CODEBERG_SUMMARY_CONTEXT_WINDOW` overrides that window. In the app, a catalog entry's `context_window` supplies the selected chat model's window, which its summarizer shares. Set these values to match the endpoints; they do not enlarge the providers' actual context limits.

## Track token usage

Open **Settings → Usage** for provider-reported **Input tokens** and **Output tokens** across projects. The **All** view shows separate **Chat** and **Learning** contributions under each token total. Choose **Chat** or **Learning** to filter the totals, daily chart, per-model counts, and request history. Changing activity returns to the first history page and keeps your UTC date range. **Export CSV** exports all matching calls in the selected activity and period, across history pages. The daily chart lets you switch between input and output tokens. Cache breakdowns and spend estimates are not displayed or included in the CSV.

Tracking covers recorded browser chat, summarization, and learning calls, including individual tool-loop steps. **Chat** includes conversation summarization; **Learning** covers model calls made by the background learning worker, including its knowledge jobs. These are usage categories: Knowledge and Learning still have separate goals. The split also applies to previously recorded calls because their activity is already stored, even when both activities use the same model. It starts with newly recorded calls; earlier history, embeddings, CLI usage, and external usage are not included. Missing token counts appear as **Not reported**, and totals include only reported counts. No model pricing configuration is required to use this view.
