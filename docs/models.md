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

Without `models.yml`, the browser offers the configured `CODEBERG_MODEL` and
`CODEBERG_SUBAGENT_MODEL` as fallback choices. To add more choices or set precise
context windows and effort lists, create the YAML file above.
