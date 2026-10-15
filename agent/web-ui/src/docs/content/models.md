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

## Select models in the app

Open **Models** in the header. Choose the chat model and effort, then the learning model and effort, and save. Changes affect new chat turns and new background jobs; work already running retains its selection. Choices persist across restarts and tabs.

Without a catalog, choices come from `CODEBERG_MODEL` and optional `CODEBERG_SUBAGENT_MODEL`. The learning model defaults to the chat model. With a valid catalog, `CODEBERG_MODEL` can be omitted. Catalog changes are read when settings are requested; provider credential changes require a restart.

## Track token usage

Open **Settings → Usage** for provider-reported **Input tokens** and **Output tokens** across projects. Choose a UTC date range to inspect daily activity, per-model counts, and request history, or export the selected range as CSV. The daily chart lets you switch between input and output tokens. Cache breakdowns and spend estimates are not displayed or included in the CSV.

Tracking covers recorded browser chat, summarization, and learning calls, including individual tool-loop steps. It starts with newly recorded calls; earlier history, embeddings, CLI usage, and external usage are not included. Missing token counts appear as **Not reported**, and totals include only reported counts. No model pricing configuration is required to use this view.
