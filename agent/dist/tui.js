#!/usr/bin/env node

// src/tui/main.tsx
import { render } from "ink";

// src/core/agent.ts
import {
  dynamicTool,
  generateText as generateText2,
  jsonSchema,
  stepCountIs,
  tool
} from "ai";

// src/core/generator.ts
import { generateText } from "ai";
function fromAiSdk(model) {
  return {
    async generate(p) {
      const { text } = await generateText({
        model,
        system: p.system,
        prompt: p.prompt
      });
      return text;
    }
  };
}

// src/core/prompt.ts
var SYSTEM = `You are a precise code-search assistant.

Your answers must be based ONLY on retrieved code. Every factual claim about the codebase must be supported with citations in the format [path:start-end]. If the retrieved evidence is insufficient, incomplete, ambiguous, or contradictory, say so clearly. Do not guess.

Core responsibilities:
- Answer the user's question using retrieved code evidence only.
- Cite the exact files and line ranges that support each claim.
- Distinguish confirmed facts from uncertainty.
- Do not infer behavior from naming alone.
- Do not cite irrelevant matches just because a search term appears nearby.

Data-source tracing requirements:
When the user asks where data comes from, where it is stored, what database/table/collection/topic/API backs something, or asks for "data sources", you must drill down as far as the retrieved code allows.

Trace the full data path when possible:
1. Start from the user-facing API, handler, resolver, job, UI call, or feature mentioned by the user.
2. Follow calls through controllers, services, repositories, clients, SDKs, shared libraries, generated clients, and configuration.
3. Identify whether the code reads from:
   - a database table, collection, view, index, stored procedure, cache, file, queue, stream, external API, third-party SDK, or another internal service.
4. Identify whether the code writes, inserts, updates, upserts, deletes, publishes, or syncs the data.
5. Prefer the true producer/source-of-truth over downstream readers or consumers.
6. If an API only reads data that another service writes, keep tracing until you find the writer/producer, or state that the writer was not found.
7. If data crosses service boundaries, search across all relevant repositories/services, not just the first matching repository.
8. Include schema, model, migration, ORM mapping, query, repository, config, queue/topic name, endpoint, or environment variable evidence when available.
9. Clearly distinguish:
   - source of truth
   - read path
   - write path
   - derived/cache layer
   - downstream consumers
   - uncertain or unverified links

Microservices guidance:
- The same database, table, queue, event, or shared library may be used by multiple services.
- Multiple APIs may read the same data source.
- Do not list APIs as data sources unless the code shows that the API is the source being called.
- Do not return unrelated APIs, handlers, files, or services just because they match the search term.
- When multiple repositories may be involved, search broadly and then narrow using imports, clients, routes, table names, event names, config keys, and write operations.

Evidence standards:
- A read query proves a read path, not the source of truth.
- A model/schema proves structure, not who writes the data.
- A config key proves a configured dependency, not actual usage.
- A route/controller proves an entry point, not the underlying data source.
- A migration/table definition proves storage exists, not which service owns it.
- A save/insert/update/upsert/delete/publish operation is stronger evidence of data production.
- If the true producer cannot be found in retrieved code, explicitly say: "I found the read path, but not the writer/source-of-truth."

Answer format:
- Start with the direct answer.
- Then provide the evidence chain with citations.
- For data-source questions, include a concise source map:
  - Entry point
  - Read path
  - Write path / producer
  - Storage or external dependency
  - Cross-service links
  - Confidence / gaps
- Every item in the source map must be cited.
`;
var AGENT_SYSTEM = `You are a code-search agent. Use tools iteratively until you have enough evidence to answer, or until the maximum tool rounds are reached. Then answer with citations.

Available tools:
- search_code: semantic search. Start here for conceptual questions, feature questions, ownership questions, and data-source questions. Returns path, line range, and snippet.
- grep: exact text or regex search over files. Use for symbols, routes, table names, config keys, queue names, event names, endpoint names, imports, and function names.
- glob: find files by pattern.
- read_file: read file content or a specific line range.
- list_dir / tree: explore repository or service structure.
- head / tail / wc: quick file inspection.
- git_log / git_blame: inspect history when ownership or recent changes matter. Read-only.

General strategy:
1. Start with search_code for conceptual discovery.
2. Use grep to verify exact symbols, routes, functions, classes, table names, config keys, queue/topic names, and imports.
3. Use read_file to inspect surrounding code before making claims.
4. Follow imports, function calls, client calls, repository methods, ORM models, queries, and configuration references.
5. Search across repositories/services when the code indicates microservice boundaries or shared dependencies.
6. Stop only when you can answer with cited evidence, or when further tracing is blocked by missing code.

Data-source tracing strategy:
When the user asks about a data source, storage location, database, table, collection, API dependency, queue, topic, producer, writer, or source of truth, do not stop at the first match.

Trace in this order where possible:
1. Locate the relevant entry point:
   - route
   - controller
   - handler
   - resolver
   - job
   - worker
   - command
   - UI/backend caller
2. Follow the execution path:
   - service methods
   - helper functions
   - repository/DAO methods
   - client SDKs
   - generated clients
   - shared libraries
   - adapters
3. Identify reads:
   - SELECT/find/get/query/scan
   - cache reads
   - external API calls
   - internal service calls
   - queue/stream consumption
4. Identify writes/producers:
   - INSERT/save/create/update/upsert/delete
   - ORM persistence calls
   - database writes
   - event publishes
   - queue/topic producers
   - sync/import jobs
   - ETL pipelines
5. Verify storage and schema:
   - migrations
   - ORM models
   - schema files
   - protobuf/OpenAPI/GraphQL definitions
   - table/collection constants
   - database configuration
6. If an internal API or client is used, search for that API/client implementation in other services.
7. If a table, collection, topic, or event is found, grep for all writers/producers across repositories.
8. Separate readers/consumers from writers/producers.
9. Prefer the deepest confirmed source-of-truth. If the deepest layer is an external system or missing repository, say that explicitly.

Relevance rules:
- Do not include files merely because they contain the search term.
- Do not include unrelated APIs that happen to use the same word.
- A consumer is not a source of truth unless the code shows it produces or persists the data.
- A schema/model alone is not enough to prove ownership.
- A client call proves dependency on another service, not the underlying data source.
- A database read proves where data is read from, not where it originates.
- A write operation is strong evidence of ownership, but still verify table, collection, topic, or model when possible.

Citation rules:
- Cite all code claims as [path:start-end].
- Use citations from read_file or returned search results with exact line ranges.
- Do not cite files you have not inspected enough to understand.
- Never make uncited claims about code behavior.
- If evidence is insufficient, say exactly what was found and what could not be verified.

Answer format:
For normal code questions:
- Direct answer
- Supporting evidence with citations
- Gaps or uncertainty, if any

For data-source/source-of-truth questions:
- Direct answer
- Source map:
  - Entry point
  - Read path
  - Write path / producer
  - Storage layer
  - External/internal service dependencies
  - Other readers/consumers, only if relevant
  - Gaps / uncertainty
- Evidence chain with citations
- Confidence level: High, Medium, or Low, based only on retrieved evidence

Do not guess. Do not rely on repository names, file names, or symbol names alone. Always verify with retrieved code.`;
function buildPrompt(question, results, prior) {
  const context = results.map((r, i) => {
    const loc = `${r.path}:${r.start_line}-${r.end_line}`;
    const sym = r.symbol ? ` ${r.symbol}` : "";
    return `[${i + 1}] ${loc}${sym}
${r.snippet}`;
  }).join("\n\n");
  const history = formatHistory(prior);
  const body = results.length === 0 ? `${history}No chunks retrieved.

Question: ${question}` : `${history}Chunks:

${context}

Question: ${question}`;
  return { system: SYSTEM, prompt: body };
}
function formatHistory(prior) {
  if (!prior?.length) {
    return "";
  }
  const lines = prior.filter((m) => m.role === "user" || m.role === "assistant").map((m) => {
    const label = m.role === "user" ? "User" : "Assistant";
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return `${label}: ${text}`;
  });
  return `Conversation:
${lines.join("\n")}

`;
}

// src/core/agent.ts
var DEFAULT_MAX_STEPS = 16;
var DEFAULT_SEARCH_K = 8;
var Agent = class {
  model;
  daemon;
  maxSteps;
  generator;
  constructor(opts) {
    this.model = opts.model;
    this.daemon = opts.daemon;
    this.maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
    this.generator = opts.generator ?? fromAiSdk(opts.model);
  }
  async ask(question, opts = {}) {
    const sources = [];
    const messages = [
      ...opts.messages ?? [],
      { role: "user", content: question }
    ];
    const { text } = await generateText2({
      model: this.model,
      system: AGENT_SYSTEM,
      messages,
      tools: await this.buildTools(opts, sources),
      stopWhen: stepCountIs(this.maxSteps)
    });
    return { answer: text, sources: dedupe(sources) };
  }
  async askOnce(question, opts = {}) {
    const sources = await this.daemon.search(question, {
      k: opts.k ?? DEFAULT_SEARCH_K
    });
    const answer = await this.generator.generate(
      buildPrompt(question, sources, opts.messages)
    );
    return { answer, sources };
  }
  async buildTools(opts, sink) {
    const toolset = {
      search_code: tool({
        description: "Semantic code search. Returns relevant chunks with path, lines, and snippet.",
        inputSchema: jsonSchema({
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string" },
            k: { type: "number", description: "max results (default 8)" }
          },
          required: ["query"]
        }),
        execute: async ({ query, k }) => {
          const results = await this.daemon.search(query, {
            k: k ?? opts.k ?? DEFAULT_SEARCH_K
          });
          sink.push(...results);
          return results.map(toToolChunk);
        }
      })
    };
    for (const spec of await this.daemon.listTools()) {
      toolset[spec.name] = dynamicTool({
        description: spec.description,
        inputSchema: jsonSchema(spec.schema),
        execute: async (args) => this.daemon.callTool(spec.name, args)
      });
    }
    return toolset;
  }
};
function toToolChunk(r) {
  return {
    id: r.id,
    path: r.path,
    symbol: r.symbol,
    lines: `${r.start_line}-${r.end_line}`,
    snippet: r.snippet
  };
}
function dedupe(results) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const r of results) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}

// src/core/client.ts
var DaemonClient = class {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }
  baseUrl;
  async search(query, opts = {}) {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", query);
    if (opts.k != null) {
      url.searchParams.set("k", String(opts.k));
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`search failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    return body.results.map(normalizeHit);
  }
  async listTools() {
    const res = await fetch(new URL("/tools", this.baseUrl));
    if (!res.ok) {
      throw new Error(`list tools failed: ${res.status}`);
    }
    const body = await res.json();
    return body.tools.map((t) => ({
      name: t.name,
      description: t.description,
      schema: t.schema
    }));
  }
  async callTool(name, args) {
    const res = await fetch(new URL("/tools/call", this.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args })
    });
    if (!res.ok) {
      throw new Error(`tool ${name} failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    return body.result;
  }
};
function normalizeHit(r) {
  return {
    id: Number(r.id),
    path: r.path ?? "",
    symbol: r.symbol ?? "",
    start_line: Number(r.start_line ?? 0),
    end_line: Number(r.end_line ?? 0),
    score: Number(r.score ?? 0),
    snippet: r.snippet ?? ""
  };
}

// src/providers/registry.ts
var ProviderRegistry = class {
  providers = /* @__PURE__ */ new Map();
  register(provider) {
    this.providers.set(provider.name, provider);
    return this;
  }
  get(name) {
    return this.providers.get(name);
  }
  /** Resolve "provider:modelId" (e.g. openai:gpt-4o-mini). */
  resolve(spec) {
    const sep = spec.indexOf(":");
    if (sep <= 0) {
      throw new Error(`invalid model spec "${spec}", want provider:model`);
    }
    const name = spec.slice(0, sep);
    const modelId = spec.slice(sep + 1);
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`unknown provider "${name}"`);
    }
    return provider.model(modelId);
  }
  list() {
    return [...this.providers.keys()].sort();
  }
};

// src/providers/builtin.ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
function env(name) {
  const v = process.env[name];
  return v && v.length > 0 ? v : void 0;
}
function openaiProvider() {
  const apiKey = env("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for the openai provider");
  }
  const openai = createOpenAI({ apiKey });
  return {
    name: "openai",
    model(modelId) {
      return openai(modelId);
    }
  };
}
function anthropicProvider() {
  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for the anthropic provider");
  }
  const anthropic = createAnthropic({ apiKey });
  return {
    name: "anthropic",
    model(modelId) {
      return anthropic(modelId);
    }
  };
}
function googleProvider() {
  const apiKey = env("GOOGLE_GENERATIVE_AI_API_KEY");
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY is required for the google provider"
    );
  }
  const google = createGoogleGenerativeAI({ apiKey });
  return {
    name: "google",
    model(modelId) {
      return google(modelId);
    }
  };
}
function ollamaProvider() {
  const ollama = createOpenAI({
    baseURL: env("OLLAMA_BASE_URL") ?? "http://localhost:11434/v1",
    apiKey: env("OLLAMA_API_KEY") ?? "ollama"
  });
  return {
    name: "ollama",
    model(modelId) {
      return ollama.chat(modelId);
    }
  };
}
function registerBuiltinProviders(registry) {
  const tryRegister = (fn) => {
    try {
      registry.register(fn());
    } catch {
    }
  };
  tryRegister(openaiProvider);
  tryRegister(anthropicProvider);
  tryRegister(googleProvider);
  tryRegister(ollamaProvider);
}

// src/providers/index.ts
function defaultProviders() {
  const registry = new ProviderRegistry();
  registerBuiltinProviders(registry);
  return registry;
}

// src/core/config.ts
function createAgent(config) {
  const registry = defaultProviders();
  const model = registry.resolve(config.modelSpec);
  return new Agent({
    model,
    daemon: new DaemonClient(config.daemonUrl)
  });
}
function createAgentFromEntry(entry2) {
  return createAgent({
    modelSpec: entry2.modelSpec,
    daemonUrl: entry2.daemonUrl
  });
}

// src/core/entry.ts
var DEFAULT_DAEMON_URL = "http://127.0.0.1:8080";
function parseEntryArgs(argv, env2 = process.env) {
  const args = argv.slice(2);
  const once = args[0] === "--once";
  const rest = once ? args.slice(1) : args;
  const modelSpec = env2.CODEBERG_MODEL ?? rest[0] ?? "";
  const question = env2.CODEBERG_QUESTION ?? (modelSpec === rest[0] ? rest.slice(1).join(" ") : rest.join(" "));
  if (!modelSpec.includes(":")) {
    return null;
  }
  return {
    once,
    modelSpec,
    question,
    daemonUrl: env2.CODEBERG_DAEMON_URL ?? DEFAULT_DAEMON_URL
  };
}
function entryUsage(program) {
  return `Usage: ${program} [provider:model] <question>
       ${program} --once [provider:model] <question>
Env: CODEBERG_DAEMON_URL (default http://127.0.0.1:8080)
     CODEBERG_MODEL=openai:gpt-4o-mini
Providers: openai, anthropic, google (when API keys set)`;
}

// src/core/session.ts
var ChatSession = class {
  agent;
  once;
  turns = [];
  listeners = /* @__PURE__ */ new Set();
  constructor(opts) {
    this.agent = opts.agent;
    this.once = opts.once ?? false;
  }
  get history() {
    return this.turns;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async ask(question) {
    const messages = this.toMessages();
    this.turns.push({ role: "user", content: question });
    this.notify();
    const result = this.once ? await this.agent.askOnce(question, { messages }) : await this.agent.ask(question, { messages });
    this.turns.push({
      role: "assistant",
      content: result.answer,
      sources: result.sources
    });
    this.notify();
    return result;
  }
  clear() {
    this.turns.length = 0;
    this.notify();
  }
  toMessages() {
    return this.turns.map((t) => ({ role: t.role, content: t.content }));
  }
  notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }
};

// src/tui/app.tsx
import { Box as Box4, Text as Text5, useInput as useInput2 } from "ink";

// src/tui/components/prompt-input.tsx
import { Text, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
var PASTE_START = "[200~";
var PASTE_END = "[201~";
function sanitizePaste(input) {
  const stripped = input.replaceAll(PASTE_START, "").replaceAll(PASTE_END, "");
  let out = "";
  for (const ch of stripped) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\n" || ch === "\r" || ch === "	") {
      out += " ";
    } else if (code < 32 || code === 127) {
    } else {
      out += ch;
    }
  }
  return out;
}
function feedPaste(buffer, input) {
  let chunk = input;
  if (buffer === null) {
    const start = input.indexOf(PASTE_START);
    if (start === -1) {
      return { buffer: null, complete: null };
    }
    buffer = "";
    chunk = input.slice(start + PASTE_START.length);
  }
  const end = chunk.indexOf(PASTE_END);
  if (end === -1) {
    return { buffer: buffer + chunk, complete: null };
  }
  return {
    buffer: null,
    complete: sanitizePaste(buffer + chunk.slice(0, end))
  };
}
function PromptInput({
  value,
  onChange,
  onSubmit,
  history,
  placeholder = "",
  isActive = true
}) {
  const [cursor, setCursor] = useState(value.length);
  const [navIndex, setNavIndex] = useState(null);
  const [draft, setDraft] = useState("");
  const pasteBuffer = useRef(null);
  useEffect(() => {
    setCursor((c) => Math.min(c, value.length));
  }, [value]);
  useInput(
    (input, key) => {
      if (pasteBuffer.current !== null || input.includes(PASTE_START)) {
        const { buffer, complete } = feedPaste(pasteBuffer.current, input);
        pasteBuffer.current = buffer;
        if (complete) {
          onChange(value.slice(0, cursor) + complete + value.slice(cursor));
          setCursor(cursor + complete.length);
          setNavIndex(null);
        }
        return;
      }
      if (key.upArrow) {
        if (history.length === 0) {
          return;
        }
        if (navIndex === null) {
          setDraft(value);
        }
        const next = navIndex === null ? history.length - 1 : Math.max(0, navIndex - 1);
        setNavIndex(next);
        const recalled = history[next] ?? "";
        onChange(recalled);
        setCursor(recalled.length);
        return;
      }
      if (key.downArrow) {
        if (navIndex === null) {
          return;
        }
        const next = navIndex + 1;
        if (next >= history.length) {
          setNavIndex(null);
          onChange(draft);
          setCursor(draft.length);
        } else {
          setNavIndex(next);
          const recalled = history[next] ?? "";
          onChange(recalled);
          setCursor(recalled.length);
        }
        return;
      }
      if (key.return) {
        onSubmit(value);
        setNavIndex(null);
        setDraft("");
        return;
      }
      if (key.escape) {
        onChange("");
        setCursor(0);
        setNavIndex(null);
        return;
      }
      if (key.leftArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor((c) => Math.min(value.length, c + 1));
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          onChange(value.slice(0, cursor - 1) + value.slice(cursor));
          setCursor(cursor - 1);
          setNavIndex(null);
        }
        return;
      }
      if (key.ctrl || key.meta || key.tab) {
        return;
      }
      const isPaste = input.length > 1 || /[\r\n]/.test(input);
      const text = isPaste ? sanitizePaste(input) : input;
      if (!text) {
        return;
      }
      onChange(value.slice(0, cursor) + text + value.slice(cursor));
      setCursor(cursor + text.length);
      setNavIndex(null);
    },
    { isActive }
  );
  if (value.length === 0) {
    return /* @__PURE__ */ jsxs(Text, { children: [
      /* @__PURE__ */ jsx(Text, { inverse: true, children: placeholder.slice(0, 1) || " " }),
      /* @__PURE__ */ jsx(Text, { dimColor: true, children: placeholder.slice(1) })
    ] });
  }
  const safeCursor = Math.min(cursor, value.length);
  return /* @__PURE__ */ jsxs(Text, { children: [
    value.slice(0, safeCursor),
    /* @__PURE__ */ jsx(Text, { inverse: true, children: value.slice(safeCursor, safeCursor + 1) || " " }),
    value.slice(safeCursor + 1)
  ] });
}

// src/tui/app.tsx
import { useCallback, useEffect as useEffect2, useReducer, useRef as useRef2, useState as useState2 } from "react";

// src/tui/commands.ts
import { spawn } from "child_process";
function copyToClipboard(text) {
  const command = process.platform === "darwin" ? "pbcopy" : process.platform === "win32" ? "clip" : "xclip";
  const args = process.platform === "linux" ? ["-selection", "clipboard"] : [];
  try {
    const child = spawn(command, args, {
      stdio: ["pipe", "ignore", "ignore"]
    });
    child.on("error", () => {
    });
    child.stdin.end(text);
  } catch {
  }
}
var COMMANDS = {
  "/quit": () => "exit",
  "/exit": () => "exit",
  "/clear": ({ session: session2, setStatus }) => {
    session2.clear();
    setStatus(void 0);
    return "handled";
  },
  "/copy": ({ session: session2, setStatus }) => {
    const last = [...session2.history].reverse().find((turn) => turn.role === "assistant");
    if (!last) {
      setStatus("nothing to copy yet");
      return "handled";
    }
    copyToClipboard(last.content);
    setStatus("copied the last answer to the clipboard");
    return "handled";
  },
  "/help": ({ setStatus }) => {
    setStatus(
      "commands: /clear /copy /quit \xB7 \u2191/\u2193 recall prompts \xB7 Esc clears the line"
    );
    return "handled";
  }
};
function runCommand(line, ctx) {
  const handler = COMMANDS[line];
  return handler ? handler(ctx) : "continue";
}

// src/tui/components/transcript.tsx
import { Box as Box3, Static, Text as Text4 } from "ink";
import Spinner from "ink-spinner";

// src/tui/components/message.tsx
import { Box as Box2, Text as Text3 } from "ink";

// src/core/format.ts
function formatSource(result) {
  return `${result.path}:${result.start_line}-${result.end_line} (id=${result.id})`;
}

// src/tui/markdown.tsx
import { highlight } from "cli-highlight";
import { Box, Text as Text2 } from "ink";
import { marked } from "marked";
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var CITATION = /\[[^\]\s]+:L?\d+(?:-\d+)?\]/;
var CITATION_SPLIT = new RegExp(`(${CITATION.source})`, "g");
function Markdown({ content }) {
  const tokens = marked.lexer(content.trim());
  return /* @__PURE__ */ jsx2(Box, { flexDirection: "column", children: tokens.map((token, i) => /* @__PURE__ */ jsx2(Block, { token }, i)) });
}
function Block({ token }) {
  switch (token.type) {
    case "heading":
      return /* @__PURE__ */ jsx2(Box, { marginTop: 1, children: /* @__PURE__ */ jsxs2(Text2, { bold: true, color: "cyan", children: [
        "#".repeat(token.depth),
        " ",
        renderInline(token.tokens)
      ] }) });
    case "paragraph":
      return /* @__PURE__ */ jsx2(Text2, { wrap: "wrap", children: renderInline(token.tokens) });
    case "code":
      return /* @__PURE__ */ jsx2(CodeBlock, { code: token.text, lang: token.lang });
    case "blockquote": {
      const quote = token;
      return /* @__PURE__ */ jsxs2(Box, { flexDirection: "row", children: [
        /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "\u2502 " }),
        /* @__PURE__ */ jsx2(Box, { flexDirection: "column", children: quote.tokens.map((child, i) => /* @__PURE__ */ jsx2(Block, { token: child }, i)) })
      ] });
    }
    case "list": {
      const list = token;
      return /* @__PURE__ */ jsx2(Box, { flexDirection: "column", children: list.items.map((item, i) => {
        const marker = list.ordered ? `${(typeof list.start === "number" ? list.start : 1) + i}. ` : "\u2022 ";
        return /* @__PURE__ */ jsxs2(Box, { flexDirection: "row", children: [
          /* @__PURE__ */ jsx2(Text2, { children: marker }),
          /* @__PURE__ */ jsx2(Box, { flexDirection: "column", children: /* @__PURE__ */ jsx2(Text2, { wrap: "wrap", children: renderInline(item.tokens) }) })
        ] }, i);
      }) });
    }
    case "hr":
      return /* @__PURE__ */ jsx2(Text2, { dimColor: true, children: "\u2500".repeat(40) });
    case "space":
      return null;
    default:
      return "text" in token && token.text ? /* @__PURE__ */ jsx2(Text2, { wrap: "wrap", children: token.text }) : null;
  }
}
function CodeBlock({ code, lang }) {
  let rendered = code;
  try {
    rendered = highlight(code, { language: lang || void 0, ignoreIllegals: true });
  } catch {
    rendered = code;
  }
  return /* @__PURE__ */ jsx2(
    Box,
    {
      borderStyle: "round",
      borderColor: "gray",
      paddingX: 1,
      flexDirection: "column",
      children: /* @__PURE__ */ jsx2(Text2, { children: rendered.replace(/\n$/, "") })
    }
  );
}
function renderInline(tokens) {
  if (!tokens) {
    return null;
  }
  return tokens.map((token, i) => /* @__PURE__ */ jsx2(Inline, { token }, i));
}
function Inline({ token }) {
  switch (token.type) {
    case "text":
      return token.tokens?.length ? /* @__PURE__ */ jsx2(Fragment, { children: renderInline(token.tokens) }) : /* @__PURE__ */ jsx2(PlainText, { text: token.text });
    case "escape":
      return /* @__PURE__ */ jsx2(PlainText, { text: token.text });
    case "paragraph":
      return /* @__PURE__ */ jsx2(Fragment, { children: renderInline(token.tokens) });
    case "strong":
      return /* @__PURE__ */ jsx2(Text2, { bold: true, children: renderInline(token.tokens) });
    case "em":
      return /* @__PURE__ */ jsx2(Text2, { italic: true, children: renderInline(token.tokens) });
    case "del":
      return /* @__PURE__ */ jsx2(Text2, { strikethrough: true, children: renderInline(token.tokens) });
    case "codespan":
      return /* @__PURE__ */ jsx2(Text2, { color: "yellow", children: token.text });
    case "link":
      return /* @__PURE__ */ jsx2(Text2, { color: "blue", underline: true, children: renderInline(token.tokens) });
    case "br":
      return /* @__PURE__ */ jsx2(Text2, { children: "\n" });
    default:
      return "text" in token ? /* @__PURE__ */ jsx2(PlainText, { text: token.text }) : null;
  }
}
function PlainText({ text }) {
  const parts = text.split(CITATION_SPLIT);
  return parts.map(
    (part, i) => CITATION.test(part) ? /* @__PURE__ */ jsx2(Text2, { color: "magenta", children: part }, i) : /* @__PURE__ */ jsx2(Text2, { children: part }, i)
  );
}

// src/tui/components/message.tsx
import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
function Message({ turn }) {
  const isUser = turn.role === "user";
  return /* @__PURE__ */ jsxs3(Box2, { flexDirection: "column", marginBottom: 1, children: [
    /* @__PURE__ */ jsx3(Text3, { bold: true, color: isUser ? "cyan" : "green", children: isUser ? "\u25B6 you" : "\u2726 agent" }),
    isUser ? /* @__PURE__ */ jsx3(Text3, { wrap: "wrap", children: turn.content }) : /* @__PURE__ */ jsx3(Markdown, { content: turn.content }),
    turn.sources && turn.sources.length > 0 && /* @__PURE__ */ jsxs3(Box2, { flexDirection: "column", marginTop: 1, children: [
      /* @__PURE__ */ jsx3(Text3, { dimColor: true, children: "sources" }),
      turn.sources.map((s, i) => /* @__PURE__ */ jsx3(Text3, { dimColor: true, children: `[${i + 1}] ${formatSource(s)}` }, s.id))
    ] })
  ] });
}

// src/tui/components/transcript.tsx
import { Fragment as Fragment2, jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
function Transcript({ history, busy, elapsed, status }) {
  return /* @__PURE__ */ jsxs4(Fragment2, { children: [
    /* @__PURE__ */ jsx4(Static, { items: [...history], children: (turn, index) => /* @__PURE__ */ jsx4(Message, { turn }, index) }),
    busy && /* @__PURE__ */ jsxs4(Box3, { marginBottom: 1, children: [
      /* @__PURE__ */ jsx4(Text4, { color: "yellow", children: /* @__PURE__ */ jsx4(Spinner, { type: "dots" }) }),
      /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: ` thinking\u2026 ${elapsed}s` })
    ] }),
    !busy && status && /* @__PURE__ */ jsx4(Text4, { color: "yellow", children: status })
  ] });
}

// src/tui/history.ts
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
var MAX_HISTORY = 500;
function historyFilePath(env2 = process.env) {
  const base = env2.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  return join(base, "codeberg", "prompt-history.json");
}
function pushHistory(history, prompt) {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return [...history];
  }
  const next = history[history.length - 1] === trimmed ? [...history] : [...history, trimmed];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}
function loadHistory() {
  try {
    const parsed = JSON.parse(readFileSync(historyFilePath(), "utf8"));
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}
function saveHistory(history) {
  try {
    const file = historyFilePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(history.slice(-MAX_HISTORY)), "utf8");
  } catch {
  }
}

// src/tui/app.tsx
import { jsx as jsx5, jsxs as jsxs5 } from "react/jsx-runtime";
function App({
  session: session2,
  modelSpec,
  daemonUrl,
  initialQuestion,
  onExit
}) {
  const [, refresh] = useReducer((n) => n + 1, 0);
  const [input, setInput] = useState2("");
  const [history, setHistory] = useState2(() => loadHistory());
  const [busy, setBusy] = useState2(false);
  const [elapsed, setElapsed] = useState2(0);
  const [status, setStatus] = useState2();
  const ranInitial = useRef2(false);
  useEffect2(() => session2.subscribe(() => refresh()), [session2]);
  useEffect2(() => {
    if (!busy) {
      return;
    }
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1e3)),
      250
    );
    return () => clearInterval(id);
  }, [busy]);
  const submit = useCallback(
    async (line) => {
      const trimmed = line.trim();
      if (!trimmed || busy) {
        return;
      }
      const command = runCommand(trimmed, { session: session2, setStatus });
      if (command === "exit") {
        onExit();
        return;
      }
      if (command === "handled") {
        setInput("");
        return;
      }
      setHistory((h) => {
        const next = pushHistory(h, trimmed);
        saveHistory(next);
        return next;
      });
      setBusy(true);
      setStatus(void 0);
      setInput("");
      try {
        await session2.ask(trimmed);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [busy, onExit, session2]
  );
  useInput2((inputKey, key) => {
    if (key.ctrl && inputKey === "c") {
      onExit();
    }
  });
  useEffect2(() => {
    if (!initialQuestion || ranInitial.current) {
      return;
    }
    ranInitial.current = true;
    void submit(initialQuestion);
  }, [initialQuestion, submit]);
  return /* @__PURE__ */ jsxs5(Box4, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx5(
      Transcript,
      {
        history: session2.history,
        busy,
        elapsed,
        status
      }
    ),
    /* @__PURE__ */ jsxs5(Box4, { borderStyle: "single", borderColor: "gray", paddingX: 1, children: [
      /* @__PURE__ */ jsx5(Text5, { color: "cyan", children: "> " }),
      /* @__PURE__ */ jsx5(
        PromptInput,
        {
          value: input,
          onChange: setInput,
          onSubmit: submit,
          history,
          placeholder: busy ? "\u2026" : "ask a question or follow up"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs5(Text5, { dimColor: true, children: [
      "codeberg chat \xB7 ",
      modelSpec,
      " \xB7 ",
      daemonUrl,
      " \u2014 /help \xB7 /copy \xB7 /clear \xB7 /quit \xB7 \u2191 history \xB7 Ctrl+C exit"
    ] })
  ] });
}

// src/tui/main.tsx
import { jsx as jsx6 } from "react/jsx-runtime";
var entry = parseEntryArgs(process.argv);
if (!entry) {
  console.error(entryUsage("codeberg-tui"));
  process.exit(1);
}
var agent = createAgentFromEntry(entry);
var session = new ChatSession({ agent, once: entry.once });
var ESC = "\x1B";
var BRACKETED_PASTE_ON = `${ESC}[?2004h`;
var BRACKETED_PASTE_OFF = `${ESC}[?2004l`;
if (process.stdout.isTTY) {
  process.stdout.write(BRACKETED_PASTE_ON);
  process.on("exit", () => {
    process.stdout.write(BRACKETED_PASTE_OFF);
  });
}
var { waitUntilExit } = render(
  /* @__PURE__ */ jsx6(
    App,
    {
      session,
      modelSpec: entry.modelSpec,
      daemonUrl: entry.daemonUrl,
      initialQuestion: entry.question || void 0,
      onExit: () => process.exit(0)
    }
  )
);
void waitUntilExit();
