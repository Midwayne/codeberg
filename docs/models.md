# Browser model settings

Put your allowlist at `$CODEBERG_HOME/models.yml` (normally
`~/.codeberg/models.yml`):

```yaml
providers:
  anthropic:
    models:
      sonnet-200k:
        model: claude-sonnet-4-6
        label: Claude Sonnet
        context_window: 200000
        efforts: [provider-default, low, medium, high]
        inputs: [text, vision, pdf] # only capabilities supported by this model/gateway
  openai:
    models:
      gpt-4o-128k:
        model: gpt-4o
        context_window: 128000
        efforts: [provider-default, none, low, medium, high]
      gpt-4o-32k:
        model: gpt-4o
        context_window: 32000
        efforts: [provider-default, none, low]
```

Each provider must be registered in the agent and have its normal credentials
configured. Each model needs an integer `context_window` of at least 1,024
tokens and one or more supported `efforts` from `provider-default`, `none`,
`minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. `max` is available for
OpenAI Responses-compatible providers (`openai` and, in the internal build,
`thinktank`) when the particular model/gateway supports it. Other providers
cannot use `max`. Each mapping **key** (for example,
`gpt-4o-32k`) identifies one selectable configuration, persisted as
`provider:key` (`openai:gpt-4o-32k`). The separate `model` field is the actual
provider model name sent to the API. Multiple keys can use the same `model` with
different context windows or effort lists. `model` may be omitted for older
catalogs, in which case the key is also the model name. `label` is optional.
Only models from configured providers appear in Settings. Model names can
include colons (quote them in YAML when necessary). The selected context window controls both chat
history compaction and in-loop pruning. For learning jobs, oversized evidence is
bounded to the selected model's window with excerpts from the beginning and end.
Only list effort levels the model supports.

`inputs` is optional and defaults to `[text]` for existing catalogs. Declare
`text` plus the file types the selected model and provider endpoint actually
accept: `vision` (images), `audio`, `video`, and `pdf`. The browser composer
offers attachments only for those declared inputs. Files are sent as embedded
data URLs with the chat history (up to 20 MB per file); the selected model must
support every attachment in that history, including when switching models.
With `vision` selected, you can also paste screenshots into the focused chat
composer with Cmd/Ctrl+V; ordinary text pastes work as before.
Support also depends on the provider API: for example, the OpenAI Responses
adapter accepts images, audio, and PDFs, while video requires an endpoint that
accepts video files (such as compatible Google models). The background learning
model continues to receive text-only extraction prompts.

`CODEBERG_MODEL` is optional when `models.yml` exists. When supplied as the
provider's actual model name, it chooses the first matching catalog entry;
otherwise the first available entry is used. `CODEBERG_SUBAGENT_MODEL` supplies the initial learning
model; `CODEBERG_REASONING` supplies the initial chat effort. A learning model
without an explicit UI selection initially uses `provider-default` effort.

Use the **Model settings** button at the top right of browser chat to choose the
chat model/effort and the background learning model/effort independently. The
server validates both against `models.yml`, then saves them atomically in
`$CODEBERG_HOME/model-settings.json`. Changes to chat apply to new turns, not
streams already underway; learning changes apply when the next background job
starts, including jobs recovered after a restart. The choices persist across
restarts and browser tabs. If a saved model disappears from the catalog, the
server falls back to the configured initial model or the first available model.
Older saved settings containing `model` instead of `key` are mapped to the first
matching entry when the catalog is upgraded.
Do not put credentials in `models.yml`.

## Usage pricing

Each model entry can define `pricing` in **USD per million tokens** for
[Settings → Usage](settings.md#model-usage-and-estimated-spending). These example
rates are illustrative; replace them with your provider or gateway's rates:

```yaml
pricing:
  input: 2
  output: 10
  cache_read: 0.2
  cache_write: 2.5
```

`input` and `output` are required when `pricing` is present. `cache_read` and
`cache_write` are optional, but cached calls need the matching rates to produce
a cost estimate. All rates must be finite, non-negative numbers. Explicit zero
rates are supported for free or local models. Omit `pricing` to track tokens
without a cost estimate. Pricing is attached to the catalog key, so variants of
the same API model can have different gateway or context-tier rates.

Input totals include cache reads and writes. Cost is calculated by subtracting
those counts from input before applying the standard input rate, then adding
each cache category and total output (including reasoning tokens) at its rate.
Missing required usage or rates produces **Unpriced**. Estimates are saved with
the call and are not recalculated after a catalog edit. Configure separate model
keys for different pricing tiers; automatic context-tier and modality pricing
are not inferred.

Without `models.yml`, the browser offers the configured `CODEBERG_MODEL` and
`CODEBERG_SUBAGENT_MODEL` as fallback choices. To add more choices or set precise
context windows and effort lists, create the YAML file above.
