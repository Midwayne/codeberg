Codeberg uses three model roles:

| Role | Purpose | Configure |
| --- | --- | --- |
| Chat | Answer questions and choose tools. | **Models** in the header. |
| Learning | Background knowledge work and evaluations. | **Models**; defaults to the chat model. |
| Embedding | Local semantic source search. | [Indexing and search](/docs/indexing). |

## Choose a provider

Set `CODEBERG_MODEL` to `provider:model` and supply the matching credential or endpoint.

| Provider | Model setting | Credential or endpoint |
| --- | --- | --- |
| OpenAI | `openai:your-model-name` | `OPENAI_API_KEY` |
| Anthropic | `anthropic:your-model-name` | `ANTHROPIC_API_KEY` |
| Google | `google:your-model-name` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Ollama | `ollama:your-model-name` | `OLLAMA_BASE_URL`; default `http://localhost:11434/v1` |
| llama.cpp | `llamacpp:your-model-label` | `LLAMACPP_BASE_URL`; default `http://localhost:8080/v1` |

```sh
codeberg config set CODEBERG_MODEL=openai:your-model-name
codeberg config edit
```

Enter credentials in the config editor, then restart. Cloud providers without a key are unavailable. Credentials belong in config or the environment, never in the model catalog.

For local providers, start the server and load a tool-capable model yourself. Both use the OpenAI-compatible Chat Completions API. For llama.cpp, the loaded model determines the actual model; the label names the connection. Codeberg does not download local chat models.

## Add a model catalog

Create `~/.codeberg/models.yml` to offer several choices. Replace this illustrative model name and window with values your endpoint supports:

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

| Field | Rule |
| --- | --- |
| `everyday` | Catalog key; the saved selection is `openai:everyday`. |
| `model` | Provider model name. Omit only if the catalog key is that name. |
| `context_window` | Required integer of at least 1,024. Match the endpoint's actual capacity. |
| `efforts` | Required nonempty list of supported reasoning efforts. |
| `inputs` | Defaults to `[text]`. Add capabilities only when the model and API support them. |

Effort values are `provider-default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. `max` requires a supported OpenAI Responses-compatible provider.

Inputs may include `vision`, `audio`, `video`, and `pdf`. Attachments are limited to **20 MB per file**. A replacement model must support attachments already in the chat.

> **Browser Use requires declared vision support.** Its model must have `inputs: [text, vision]`, even when screenshots are off. The separate **Browser vision** switch controls screenshot access. See [Browser Use](/docs/browser-use).

## Select models in the app

Open **Models**, choose chat and learning models and efforts, then save. Changes apply to new turns and background jobs; running work keeps its selection. Choices persist across restarts and tabs.

| Setup | Available choices |
| --- | --- |
| No catalog | `CODEBERG_MODEL` and optional `CODEBERG_SUBAGENT_MODEL`. |
| Valid catalog | Available catalog entries; `CODEBERG_MODEL` may be omitted. |

Catalog edits are read when settings are requested. Credential and launcher-config changes require a restart.

## How chat context stays bounded

Codeberg archives large tool results locally and summarizes older exchanges when history approaches the model's budget. Recent exchanges and the current request stay available; the agent can recover omitted details from saved context.

- Tool results over **12,000 characters** become previews with paths to full output.
- Reusable summaries live in the project's `context/checkpoints/` directory.
- The default working ceiling is **200,000 tokens**, capped by the model window. Half is reserved for history.
- Chat output is capped at **8,192 tokens** or **15%** of the working window, whichever is smaller, with another 15% estimation margin.
- Anthropic thinking budgets also consume completion space; high effort can leave less room for history.

A context-limit error can trigger up to three smaller retries. Completed local tool calls are retained. Recovery after streamed output begins is limited; authentication, rate-limit, and cancellation errors do not trigger context recovery.

If the current request still cannot fit, narrow attachments, reduce integrations, lower effort, or use a larger window. Estimates for text and media are approximate. See [Environment variables](/docs/environment#context-and-tool-calling) for window overrides and [Data and maintenance](/docs/storage) for saved context.

## Track token usage

Open **Settings → Usage**. **All**, **Chat**, and **Learning** filter totals, the daily input/output chart, model counts, request history, and **Export CSV**. The UTC date range stays selected; changing activity resets pagination. CSV includes all matching pages.

| Category | Includes |
| --- | --- |
| Chat | Recorded browser chat and conversation summarization. |
| Learning | Background worker calls, including knowledge jobs and automatic evaluations. |
| Not reported | A request whose provider omitted token counts. |

Totals include reported counts only. Embeddings, CLI calls, Browser Use calls, external usage, and usage before recording began are excluded. Cache breakdowns and spend estimates are omitted; pricing configuration is unnecessary.

## Embed the TypeScript agent

`AgentOptions.model` accepts an AI SDK model instance or an SDK string ID such as `openai/gpt-4o`. String IDs use the SDK's default provider, falling back to its gateway, and keep Codeberg's context budgeting. These IDs are separate from launcher `provider:model` settings.
