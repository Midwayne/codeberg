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

## Use a decisions API

Enable a separate, optional `decide` tool for the main agent. It can call the tool whenever useful to choose candidate files, score search-result relevance, check evidence, or select a next step. Your chat model still discovers candidates and writes the answer; Codeberg can forward source excerpts directly to the decisions model before the chat model reads them. The agent decides when the tool is useful.

1. Add `decision_models` under providers in `$CODEBERG_HOME/models.yml`. Keep your existing text `models` entries; at least one available text model is required.
2. Set the matching API key in your launcher config or environment and restart Codeberg. Keep credentials out of `models.yml`.
3. Open **Models → Decisions API**, select a model, and save. **Off** removes the tool. Changes apply to the next chat turn; active turns retain their selection.

Merge these entries into your existing `providers` mapping:

```yaml
# Optional initial choice; omit or use null to default to Off.
decisions: openai:fast
providers:
  openai:
    # Keep your text models here too.
    decision_models:
      fast:
        model: gpt-6-luna
        label: OpenAI decisions
  typesafe:
    decision_models:
      fast:
        model: jev-latest
        label: TypeSafe Jev
  openrouter:
    decision_models:
      clef:
        model: cloudflare/clef
        label: Clef via OpenRouter
```

The mapping key is a selectable `provider:key`; `model` is the provider's actual model ID. `label` is optional. Decision models do not use `context_window`, `efforts`, or text-model provider registration. Only entries with a nonempty credential appear in the selector. Your saved choice in `model-settings.json`, including **Off**, overrides the YAML default. If that choice becomes unavailable, decisions turn off without selecting a different provider. CLI agents also load this saved choice or YAML default at startup.

| Provider | Default API endpoint | Credential |
| --- | --- | --- |
| `openai` | `https://api.openai.com/v1/decisions` | `OPENAI_API_KEY` |
| `typesafe` | `https://api.typesafe.ai/v1/systemone` | `TYPESAFE_API_KEY` |
| `openrouter` | `https://openrouter.ai/api/alpha/decisions` | `OPENROUTER_API_KEY` |

For another compatible provider, set `decision_api` (`openai`, `system-one`, or `cloudflare`), `decision_endpoint` (the full POST URL), and `decision_api_key_env` on its provider entry. `cloudflare` uses System One requests and unwraps the Workers AI `result` envelope. For example:

```yaml
providers:
  cloudflare:
    decision_api: cloudflare
    decision_endpoint: https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/run/@cf/cloudflare/clef
    decision_api_key_env: CLOUDFLARE_API_TOKEN
    decision_models:
      clef:
        model: clef
```

Custom endpoints use Bearer authentication. Export a custom credential variable before launching; the launcher config recognizes the three credentials above and `CLOUDFLARE_API_TOKEN`. Endpoint overrides must not contain credentials, query parameters, or fragments.

### Ask the agent to use decisions

```text
Find candidate files for the caching bug. Use decide to score each candidate
against search snippets first. If those are insufficient, forward candidate
file ranges directly to decide, then read the relevant files to verify the cause.
```

The agent sends shared text evidence and 1–64 independent, named questions in one call:

| Question | Result | Example |
| --- | --- | --- |
| `predicate` | Probability from 0 to 1. | Does this snippet implement cache invalidation? |
| `choice` | One of 2–64 distinct string values. | Which candidate file should be read first? |
| `score` | Weighted score across 2–10 ordered rubric levels, indexed from 0. | How relevant is each candidate to the bug? |

### Forward candidate files without filling chat context

The agent can provide repository keys, relative paths, and optional line ranges in `files`. Codeberg reads those ranges through the same project-scoped daemon used by `read_file` and sends the bounded excerpts to the configured decisions provider. The main model receives judgments and coverage metadata, without the source bodies. Local paths and uploaded file IDs do not give the provider direct repository access.

For example, the agent can call `decide` with:

```json
{
  "state": "Find files relevant to stale cache entries after a write.",
  "files": [
    { "repo": "app", "path": "src/cache.ts", "start_line": 40, "end_line": 120 },
    { "repo": "app", "path": "src/routes.ts" }
  ]
}
```

With `questions` omitted, Codeberg batches one independent relevance predicate per unique file. Each returned file summary names its corresponding question. Several candidates can have high relevance; no file is automatically discarded. To choose exactly one next file or action, the agent can instead supply a custom `choice` question; its probability distribution sums to approximately 1 across the alternatives. Choice probabilities describe that selection, rather than independent relevance for each file. Custom `score` questions return a distribution over rubric levels.

| Limit | Behavior |
| --- | --- |
| Files per call | 1–8; exact duplicate paths/ranges are read once. |
| Excerpt per file | At most 200 lines and 4,000 characters. The default range is the first 200 lines; choose ranges from search hits for deeper code. |
| State with files | At most 8,000 characters. |
| State plus forwarded evidence | At most 48,000 characters; narrow ranges if encoded evidence exceeds this bound. |
| Complete request | At most 128,000 serialized characters, including questions. |
| Custom questions | 1–64; instructions are at most 4,000 characters each. |

Coverage metadata reports lines, character counts, and whether the excerpt covers only part of the file. A truncated excerpt or low score does not prove the rest of a file irrelevant. If any candidate cannot be read, the tool reports that file and makes no provider call; correct the path or narrow the candidate list. Images, audio, file uploads, prose generation, and arbitrary JSON outputs are not exposed by this tool. Probability and confidence values are estimates; retain uncertain candidates and verify important conclusions by reading source.

### Keep decision calls economical

- **Start with existing snippets.** Forward source ranges when their extra evidence is worth the call. Avoid sending the entire chat or full files by default.
- **Batch independent judgments.** File relevance, evidence checks, hypothesis comparisons, and suggested test priorities can share one request. Dependent questions still need separate calls.
- **Reuse exact decisions within a run.** Browser runs and CLI questions retain at most 32 successful results for 60 seconds. Identical concurrent calls share one request. Reuse is marked `cached: true`, does not record another provider request, and omits new usage counts. Runs do not share these local results. File excerpts are reread before lookup; changed evidence, questions, model, endpoint, or credentials produce a new decision. Failed requests are not reused.
- **Reuse provider prompt prefixes.** For OpenAI file inputs, Codeberg puts sorted source evidence first and marks it as an explicit cache boundary with a 30-minute TTL. The changing task follows it. Provider cache reuse requires an identical qualifying prefix (at least 1,024 tokens); it is separate from local result reuse. Small or changing inputs may receive no cache discount.
- **Preserve useful batch answers.** If a provider refuses one question, the tool retains that per-question refusal and any valid answers to other questions. It does not replay the entire batch automatically.

The [OpenAI Decisions reference](https://developers.openai.com/api/reference/resources/decisions/methods/create) currently lists a 30-minute prompt-cache TTL and no `service_tier` request field. Codeberg does not apply Responses API Fast, Flex, Batch, or 12-hour retention options to Decisions. Cache writes can add charges; rates and availability depend on the selected provider.

Decision calls add provider charges and a chat tool round trip. They may reduce source bodies sent to the chat model and repeated provider calls, but savings depend on the investigation; enabling the option does not guarantee lower cost. Browser decision calls are recorded separately under **Decisions** in Usage with their own model attribution and provider-reported counts. Cache read/write counts are recorded when reported and are already part of the input-token total; they are not added again. CLI calls remain excluded. A 15-second timeout, provider error, or invalid answer returns a tool error; the main agent can continue using ordinary tools. For missing choices, check the credential and model ID, reload Models after catalog edits, or set **Off** to disable the integration.

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

Open **Settings → Usage**. **All**, **Chat**, **Learning**, and **Decisions** filter totals, the daily input/output chart, model counts, request history, and **Export CSV**. The UTC date range stays selected; changing activity resets pagination. CSV includes all matching pages. The All view shows separate input/output contributions for the three activities.

| Category | Includes |
| --- | --- |
| Chat | Recorded browser chat and conversation summarization. |
| Learning | Background worker calls, including knowledge jobs and automatic evaluations. |
| Decisions | Provider calls made by the browser agent's `decide` tool; local result-cache hits do not add calls or tokens. |
| Not reported | A request whose provider omitted token counts. |

Totals include reported counts only. Embeddings, CLI calls, Browser Use calls, external usage, and usage before recording began are excluded. Cache breakdowns and spend estimates are omitted; pricing configuration is unnecessary.

The Decisions category applies to newly recorded calls. Older decision records saved as Chat retain that category; they lack a reliable API-type marker for automatic reclassification. A model used for both chat and decisions is separated by activity for new calls, even when its provider model ID is identical.

## Embed the TypeScript agent

`AgentOptions.model` accepts an AI SDK model instance or an SDK string ID such as `openai/gpt-4o`. String IDs use the SDK's default provider, falling back to its gateway, and keep Codeberg's context budgeting. These IDs are separate from launcher `provider:model` settings.
