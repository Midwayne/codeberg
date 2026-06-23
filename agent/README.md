# Codeberg agent

Token-efficient code-search agent over `codeberg-d`, built with [ai-sdk](https://sdk.vercel.ai).

## Install

```sh
cd agent && npm install && npm run build
```

Requires a running `codeberg-d` with vector indexing enabled.

## CLI

```sh
export OPENAI_API_KEY=...
export CODEBERG_ROOT=...
codeberg-ask openai:gpt-4o-mini "how is authentication handled?"
codeberg-ask --once anthropic:claude-sonnet-4-6 "where is the main entry point?"
```

## Providers

Built-in (when API keys are set):

| Provider | Env var | Example model |
|----------|---------|---------------|
| `openai` | `OPENAI_API_KEY` | `openai:gpt-4o-mini` |
| `anthropic` | `ANTHROPIC_API_KEY` | `anthropic:claude-sonnet-4-6` |
| `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `google:gemini-2.0-flash` |

### Custom provider

```ts
import { Agent, DaemonClient, ProviderRegistry } from "@codeberg/agent";
import { myProvider } from "./my-provider.js";

const registry = new ProviderRegistry();
registry.register(myProvider);
const model = registry.resolve("myprov:model-id");

const agent = new Agent({ model, daemon: new DaemonClient("http://127.0.0.1:8080") });
const { answer, sources } = await agent.ask("how does search work?");
```

Implement `ModelProvider`:

```ts
import type { ModelProvider } from "@codeberg/agent";

export const myProvider: ModelProvider = {
  name: "myprov",
  model(modelId) {
    // return an ai-sdk LanguageModel
  },
};
```

## API

- `agent.ask(question)` — tool loop (default 6 steps), semantic search + daemon tools
- `agent.askOnce(question)` — single search + one LLM call (lower token use)
