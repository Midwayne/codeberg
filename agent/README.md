# Codeberg agent

Token-efficient code-search agent over `codeberg-d`, built with [ai-sdk](https://sdk.vercel.ai).

## Install

```sh
cd agent && npm install && npm run build
```

Requires a running `codeberg-d` with vector indexing enabled.

## CLI

Single-shot questions (unchanged):

```sh
export OPENAI_API_KEY=...
export CODEBERG_ROOT=...
codeberg-ask openai:gpt-4o-mini "how is authentication handled?"
codeberg-ask --once anthropic:claude-sonnet-4-6 "where is the main entry point?"
```

## TUI

Interactive chat, rendered by ai-sdk's `runAgentTUI` — streamed tool calls,
collapsible reasoning, and live output-throughput stats:

```sh
codeberg-tui anthropic:claude-sonnet-4-6
```

The TUI owns its own input and session, so the CLI-only `--once` / seeded-question
flags do not apply here — pass just `provider:model` and chat. Exit with `Ctrl+C`.

## Web

The browser counterpart to the TUI — a React chat UI (ai-sdk `useChat` +
[streamdown](https://github.com/vercel/streamdown)) with streaming markdown,
syntax-highlighted code, collapsible reasoning, generic tool cards, and
`search_code` results rendered as file cards with snippets:

```sh
cd web-ui && npm install && npm run build   # one-time: build the SPA
codeberg-web anthropic:claude-sonnet-4-6     # → http://127.0.0.1:48088
```

Set `CODEBERG_WEB_PORT` (or `PORT`) for the port, or `CODEBERG_WEB_ROOT` to point
at a prebuilt SPA elsewhere. Like the TUI, it ignores the `--once` /
seeded-question flags — pass just `provider:model`.

Both UIs drive the identical `toolLoopAgent()`. The route (`POST /api/chat`) is
stateless: the browser holds the conversation and re-sends it each turn, mapping
straight onto ai-sdk's `pipeAgentUIStreamToResponse`. If `web-ui/dist` is not
built, the server falls back to a dependency-free single-file page, so
`codeberg-web` still works with no frontend build at all.

### Frontend dev

```sh
cd web-ui && npm run dev    # Vite on :5173, /api proxied to codeberg-web (:48088)
```

The UI is built on the same engine as Vercel's AI Elements; `web-ui/components.json`
is included so you can `npx ai-elements@latest add <component>` to pull official
components in.

## Layout

```
src/
  core/       agent, client, session, config
  providers/  model registry
  cli/        codeberg-ask
  tui/        codeberg-tui
  web/        codeberg-web (node:http: /api/chat + serves the SPA)
web-ui/       React chat SPA (Vite); built to web-ui/dist, served by codeberg-web
```

## Providers

Built-in (when API keys are set):

| Provider | Env var | Example model |
|----------|---------|---------------|
| `openai` | `OPENAI_API_KEY` | `openai:gpt-4o-mini` |
| `anthropic` | `ANTHROPIC_API_KEY` | `anthropic:claude-sonnet-4-6` |
| `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `google:gemini-2.0-flash` |
| `ollama` | _(none)_ — local; `OLLAMA_BASE_URL` optional | `ollama:qwen3.5:9b` |
| `llamacpp` | _(none)_ — local; `LLAMACPP_BASE_URL` optional | `llamacpp:ornith-1.0-35b` |

`ollama` targets a local [Ollama](https://ollama.com) server (OpenAI-compatible
API at `http://localhost:11434/v1`). No key needed; pull the model first
(`ollama pull <model>`) and use the exact tag from `ollama list`. The model must
support tool calling for the default `agent.ask` loop — otherwise use `--once`.

`llamacpp` targets a running [llama.cpp](https://github.com/ggml-org/llama.cpp)
`llama-server` (OpenAI-compatible API, default `http://localhost:8080/v1`). No
key needed. llama-server serves whichever model was loaded with `-m`, so the
model id is a free-form label (`llamacpp:anything`). Set `LLAMACPP_BASE_URL` if
you started the server on a different port (e.g. `--port 11434`). As with
ollama, the model must support tool calling for the default `agent.ask` loop.

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

- `agent.ask(question, { messages })` — tool loop with optional prior turns
- `agent.askOnce(question, { messages })` — single search + one LLM call
- `ChatSession` — multi-turn wrapper that tracks history for follow-ups
