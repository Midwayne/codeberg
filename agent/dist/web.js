#!/usr/bin/env node

// src/web/main.ts
import { fileURLToPath } from "url";

// src/core/agent.ts
import {
  dynamicTool,
  jsonSchema,
  pruneMessages,
  stepCountIs,
  tool,
  ToolLoopAgent
} from "ai";

// src/core/cache.ts
function stableKey(parts) {
  const joined = parts.join("|");
  let h = 2166136261;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
function cachedInstructions(system, profile) {
  if (profile.cache === "anthropic") {
    return {
      role: "system",
      content: system,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } }
      }
    };
  }
  return system;
}
function requestProviderOptions(system, toolNames, profile) {
  if (profile.cache === "openai") {
    return {
      openai: {
        promptCacheKey: `codeberg-${stableKey([system, ...toolNames])}`,
        promptCacheRetention: "24h"
      }
    };
  }
  return void 0;
}
function deterministicTools(tools) {
  const sorted = {};
  for (const name of Object.keys(tools).sort()) {
    sorted[name] = tools[name];
  }
  return sorted;
}

// src/core/evidence.ts
var EvidenceLedger = class {
  // Insertion-ordered: a Map preserves first-seen order, newest at the end.
  seen = /* @__PURE__ */ new Map();
  max;
  constructor(max = 40) {
    this.max = max;
  }
  add(results) {
    for (const r of results) {
      if (!this.seen.has(r.id)) {
        this.seen.set(r.id, r);
      }
    }
  }
  get size() {
    return this.seen.size;
  }
  /** One line per chunk (path:lines symbol), most recent first. Bounded to
   *  `max` rows. Returns null when empty so callers can skip injection. */
  render() {
    if (this.seen.size === 0) {
      return null;
    }
    const rows = [...this.seen.values()].slice(-this.max).reverse().map((r) => {
      const sym = r.symbol ? ` ${r.symbol}` : "";
      return `- ${r.path}:${r.start_line}-${r.end_line}${sym}`;
    });
    return "<evidence_ledger>\nCode already retrieved this conversation (reference it directly; search again only if you need fresh content):\n" + rows.join("\n") + "\n</evidence_ledger>";
  }
};

// src/core/history.ts
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function textOf(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map(
    (part) => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""
  ).join("");
}
function messageTokens(message) {
  return estimateTokens(textOf(message.content));
}
function totalTokens(messages) {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0);
}
var DEFAULT_KEEP_RECENT = 6;
async function fitHistory(messages, opts) {
  if (totalTokens(messages) <= opts.budget) {
    return messages;
  }
  const keepRecent = opts.keepRecent ?? DEFAULT_KEEP_RECENT;
  const split = Math.max(0, messages.length - keepRecent);
  const older = messages.slice(0, split);
  const recent = messages.slice(split);
  if (older.length === 0) {
    return messages;
  }
  if (opts.summarize) {
    const transcript = older.map((m) => `${m.role}: ${textOf(m.content)}`).join("\n");
    const summary = await opts.summarize(transcript);
    const marker2 = {
      role: "user",
      content: `<conversation_summary>
${summary}
</conversation_summary>`
    };
    return fitHistory([marker2, ...recent], { ...opts, summarize: void 0 });
  }
  const marker = {
    role: "user",
    content: `[${older.length} earlier message(s) omitted to fit the context window]`
  };
  return [marker, ...recent];
}

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
var DATA_SOURCE_EXAMPLE = `<example>
<question>Where do account balances come from?</question>
<answer>
Account balances are read from the Postgres \`balances\` table by accounts-api, but the source of truth is ledger-worker, which consumes \`transactions\` events off Kafka and upserts the rolled-up balance.

Source map:
- Entry point: BalanceController.getBalance [accounts-api/src/controller/BalanceController.java:22-40]
- Read path: BalanceRepository.findByAccountId -> SELECT on \`balances\` [accounts-api/src/repo/BalanceRepository.java:15-31]
- Write path / producer: TransactionConsumer -> LedgerService.applyTransaction upserts the balance [ledger-worker/src/kafka/TransactionConsumer.java:18-44] [ledger-worker/src/service/LedgerService.java:50-78]
- Storage: Postgres \`balances\` table [ledger-worker/src/db/migrations/V3__balances.sql:1-12]
- Other readers: reporting-api reads the same table but never writes it [reporting-api/src/repo/BalanceRepository.java:10-24]
- Gaps: the producer of the \`transactions\` events is outside the retrieved code.
- Confidence: High
</answer>
</example>`;
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

Example of a well-formed data-source answer:
${DATA_SOURCE_EXAMPLE}
`;
var AGENT_SYSTEM = `You are a code-search agent. Use tools iteratively until you have enough evidence to answer, or until the maximum tool rounds are reached. Then answer with citations.

Available tools:
- search_code: semantic search. Start here for conceptual questions, feature questions, ownership questions, and data-source questions. Returns path, line range, and snippet.
- grep: exact text or regex search over files. Use for symbols, routes, table names, config keys, queue names, event names, endpoint names, imports, and function names.
- glob: find files by pattern.
- read_file: read file content or a specific line range.
- list_dir / tree: explore repository or service structure.
- head / tail / wc: quick file inspection.
- pipe: run a read-only shell-style pipeline in ONE call, chaining rg/grep with filters (head, tail, wc, sort, uniq, cut, tr, nl, cat, paste, sed) using "|". Prefer this to combine a search with filtering \u2014 e.g. \`rg -l 'func main' --glob '*.go' | head -20\` or \`rg TODO | wc -l\` \u2014 instead of issuing separate grep + head/wc calls. No shell is run, so redirection, ";", "&", and "$()" are rejected and paths cannot escape the repo.
- git_log / git_blame: inspect history when ownership or recent changes matter. Read-only.

General strategy:
1. Start with search_code for conceptual discovery.
2. Use grep to verify exact symbols, routes, functions, classes, table names, config keys, queue/topic names, and imports.
3. Use read_file to inspect surrounding code before making claims.
4. Follow imports, function calls, client calls, repository methods, ORM models, queries, and configuration references.
5. Search across repositories/services when the code indicates microservice boundaries or shared dependencies.
6. Prefer a single pipe call over several grep/read_file/head/wc calls when the work is expressible as a pipeline \u2014 it is faster and uses fewer tokens.
7. Stop only when you can answer with cited evidence, or when further tracing is blocked by missing code.

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

Example of a well-formed data-source answer:
${DATA_SOURCE_EXAMPLE}

Do not guess. Do not rely on repository names, file names, or symbol names alone. Always verify with retrieved code.`;
function buildPrompt(question, results, prior) {
  const evidence = results.length === 0 ? "No chunks retrieved." : results.map((r, i) => {
    const loc = `${r.path}:${r.start_line}-${r.end_line}`;
    const sym = r.symbol ? ` ${r.symbol}` : "";
    return `[${i + 1}] ${loc}${sym}
${r.snippet}`;
  }).join("\n\n");
  const body = `${formatHistory(prior)}<retrieved_code>
${evidence}
</retrieved_code>

<question>${question}</question>`;
  return { system: SYSTEM, prompt: body };
}
function formatHistory(prior) {
  if (!prior?.length) {
    return "";
  }
  const turns = [];
  for (const m of prior) {
    if (m.role !== "user" && m.role !== "assistant") {
      continue;
    }
    const text = textOf2(m.content);
    if (text) {
      turns.push(`<turn role="${m.role}">${text}</turn>`);
    }
  }
  if (turns.length === 0) {
    return "";
  }
  return `<conversation>
${turns.join("\n")}
</conversation>

`;
}
function textOf2(content) {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) => part.type === "text" ? part.text : "").join("").trim();
}

// src/providers/profiles.ts
var ONE_MILLION = 1e6;
function windowFor(provider, modelId) {
  const id = modelId.toLowerCase();
  switch (provider) {
    case "anthropic":
      return id.includes("haiku") ? 2e5 : ONE_MILLION;
    case "google":
      return ONE_MILLION;
    case "openai":
      return /gpt-4\.1|gpt-5|(^|[^a-z])o\d/.test(id) ? ONE_MILLION : 128e3;
    case "ollama":
    case "llamacpp":
      return 8192;
    default:
      return 32e3;
  }
}
function cacheFor(provider) {
  switch (provider) {
    case "anthropic":
      return "anthropic";
    // ollama / llamacpp speak the OpenAI wire format; the cache key is harmless
    // to them and they reuse a matching prompt prefix on their own.
    case "openai":
    case "ollama":
    case "llamacpp":
      return "openai";
    default:
      return "none";
  }
}
function profileFor(spec, env2 = process.env) {
  const sep2 = spec.indexOf(":");
  const provider = sep2 > 0 ? spec.slice(0, sep2) : "";
  const modelId = sep2 > 0 ? spec.slice(sep2 + 1) : spec;
  const override = Number(env2.CODEBERG_CONTEXT_WINDOW);
  const contextWindow = Number.isFinite(override) && override > 0 ? Math.floor(override) : windowFor(provider, modelId);
  return { provider, modelId, contextWindow, cache: cacheFor(provider) };
}
var DEFAULT_PROFILE = {
  provider: "",
  modelId: "",
  contextWindow: ONE_MILLION,
  cache: "none"
};
var HISTORY_BUDGET_FRACTION = 0.5;
var PRUNE_BUDGET_FRACTION = 0.6;
function historyBudget(profile) {
  return Math.floor(profile.contextWindow * HISTORY_BUDGET_FRACTION);
}
function pruneBudget(profile) {
  return Math.floor(profile.contextWindow * PRUNE_BUDGET_FRACTION);
}

// src/core/agent.ts
var DEFAULT_MAX_STEPS = 16;
var DEFAULT_SEARCH_K = 8;
var DEFAULT_TIMEOUT = {
  totalMs: 3e5,
  stepMs: 12e4,
  chunkMs: 6e4
};
var Agent = class {
  model;
  daemon;
  maxSteps;
  generator;
  reasoning;
  profile;
  // Built once on first use (tools require an async daemon round-trip), then
  // reused across every ask instead of reconstructing the loop each call.
  loop;
  // Per-ask buffer of the full search hits behind the compact chunks shown to
  // the model. Reset at the top of each `ask`; safe because asks are awaited
  // sequentially (no concurrent runs share this Agent instance).
  sources = [];
  // Conversation-lifetime index of everything retrieved, injected each turn so
  // the model needn't re-search. Persists across asks (unlike `sources`).
  ledger = new EvidenceLedger();
  constructor(opts) {
    this.model = opts.model;
    this.daemon = opts.daemon;
    this.maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
    this.generator = opts.generator ?? fromAiSdk(opts.model);
    this.reasoning = opts.reasoning;
    this.profile = opts.profile ?? DEFAULT_PROFILE;
  }
  async ask(question, opts = {}) {
    this.sources = [];
    const loop = await this.ensureLoop();
    const history = await this.compactHistory(opts.messages ?? []);
    const ledger = this.ledger.render();
    const messages = [
      ...history,
      ...ledger ? [{ role: "user", content: ledger }] : [],
      { role: "user", content: question }
    ];
    const result = await loop.generate({ messages });
    const sources = dedupe(this.sources);
    this.ledger.add(sources);
    return {
      answer: result.text,
      sources,
      performance: toPerformance(result.finalStep?.performance)
    };
  }
  /** Compact a transcript to fit this model's history budget, summarizing the
   *  overflow with the model itself. Exposed so the TUI session wrapper can
   *  apply the same policy to its own (separately driven) transcript. */
  async compactHistory(messages) {
    return fitHistory(messages, {
      budget: historyBudget(this.profile),
      summarize: (transcript) => this.summarize(transcript)
    });
  }
  /** Bound compactor for callers that drive the loop directly (the TUI). */
  historyCompactor() {
    return (messages) => this.compactHistory(messages);
  }
  async summarize(transcript) {
    return this.generator.generate({
      system: "Summarize this code-search conversation for an agent that will continue it. Preserve every concrete finding: file paths, line ranges, symbols, data sources, and unresolved questions. Be terse; drop pleasantries and restated questions.",
      prompt: transcript
    });
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
  /** The underlying ai-sdk v7 agent, for callers that drive their own loop
   *  (e.g. `runAgentTUI`). Built lazily and cached, same instance as `ask`. */
  async toolLoopAgent() {
    return this.ensureLoop();
  }
  async ensureLoop() {
    if (!this.loop) {
      const tools = deterministicTools(await this.buildTools());
      const providerOptions = requestProviderOptions(
        AGENT_SYSTEM,
        Object.keys(tools),
        this.profile
      );
      const prune = pruneBudget(this.profile);
      this.loop = new ToolLoopAgent({
        model: this.model,
        // Cache the large, frozen system prompt instead of re-billing it on
        // every tool round and every turn.
        instructions: cachedInstructions(AGENT_SYSTEM, this.profile),
        tools,
        stopWhen: stepCountIs(this.maxSteps),
        timeout: DEFAULT_TIMEOUT,
        ...providerOptions ? { providerOptions } : {},
        ...this.reasoning ? { reasoning: this.reasoning } : {},
        // Context editing for the in-flight loop: once accumulated tool results
        // cross the high-water mark, clear the older ones (keeping the two most
        // recent messages intact) so a deep, tool-heavy ask can't blow the
        // window. The cleared pairs are dropped together, never half-removed.
        prepareStep: ({ messages }) => totalTokens(messages) > prune ? {
          messages: pruneMessages({
            messages,
            toolCalls: "before-last-2-messages",
            emptyMessages: "remove"
          })
        } : void 0
      });
    }
    return this.loop;
  }
  async buildTools() {
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
            k: k ?? DEFAULT_SEARCH_K
          });
          this.sources.push(...results);
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
function toPerformance(perf) {
  if (!perf) {
    return void 0;
  }
  return {
    outputTokensPerSecond: perf.effectiveOutputTokensPerSecond,
    responseTimeMs: perf.responseTimeMs
  };
}
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
    const sep2 = spec.indexOf(":");
    if (sep2 <= 0) {
      throw new Error(`invalid model spec "${spec}", want provider:model`);
    }
    const name = spec.slice(0, sep2);
    const modelId = spec.slice(sep2 + 1);
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
function llamacppProvider() {
  const llamacpp = createOpenAI({
    baseURL: env("LLAMACPP_BASE_URL") ?? "http://localhost:8080/v1",
    apiKey: env("LLAMACPP_API_KEY") ?? "llama.cpp"
  });
  return {
    name: "llamacpp",
    model(modelId) {
      return llamacpp.chat(modelId);
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
  tryRegister(llamacppProvider);
}

// src/providers/index.ts
function defaultProviders() {
  const registry = new ProviderRegistry();
  registerBuiltinProviders(registry);
  return registry;
}

// src/core/config.ts
var REASONING_EFFORTS = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh"
];
function reasoningFromEnv(env2 = process.env) {
  const value = env2.CODEBERG_REASONING;
  return value && REASONING_EFFORTS.includes(value) ? value : void 0;
}
function createAgent(config) {
  const registry = defaultProviders();
  const model = registry.resolve(config.modelSpec);
  return new Agent({
    model,
    daemon: new DaemonClient(config.daemonUrl),
    reasoning: config.reasoning,
    // Resolve the model's memory limit + caching strategy from the same spec so
    // the agent budgets context and marks the cache prefix correctly.
    profile: profileFor(config.modelSpec)
  });
}
function createAgentFromEntry(entry) {
  return createAgent({
    modelSpec: entry.modelSpec,
    daemonUrl: entry.daemonUrl,
    reasoning: reasoningFromEnv()
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

// src/web/server.ts
import { readFile as readFile2 } from "fs/promises";
import {
  createServer
} from "http";
import { extname, join as join2, resolve, sep } from "path";
import { pipeAgentUIStreamToResponse } from "ai";

// src/web/page.ts
var CHAT_PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{{TITLE}}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
    background: #0d1117; color: #e6edf3;
  }
  header {
    padding: 10px 16px; border-bottom: 1px solid #30363d;
    font-size: 12px; color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  .msg { max-width: 760px; width: 100%; align-self: center; }
  .role { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #8b949e; margin-bottom: 4px; }
  .msg-user .text { background: #1f6feb22; border: 1px solid #1f6feb55; }
  .text { white-space: pre-wrap; word-wrap: break-word; padding: 10px 12px; border-radius: 8px; background: #161b22; border: 1px solid #30363d; }
  .reasoning { white-space: pre-wrap; color: #8b949e; font-style: italic; padding: 6px 12px; border-left: 2px solid #30363d; margin: 4px 0; }
  .tool { margin: 6px 0; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 6px 10px; }
  .tool summary { cursor: pointer; color: #d29922; font-family: ui-monospace, monospace; font-size: 13px; }
  .tool pre { margin: 8px 0 4px; padding: 8px; background: #0d1117; border-radius: 6px; overflow-x: auto; font-size: 12px; color: #adbac7; }
  .tool pre:empty { display: none; }
  .error { color: #f85149; padding: 8px 12px; border: 1px solid #f8514955; border-radius: 8px; }
  form { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #30363d; }
  #prompt { flex: 1; padding: 10px 12px; border-radius: 8px; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; font: inherit; }
  #prompt:focus { outline: none; border-color: #1f6feb; }
  button { padding: 0 18px; border-radius: 8px; border: 1px solid #238636; background: #238636; color: white; font: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
</style>
</head>
<body>
<header>{{TITLE}}</header>
<div id="messages"></div>
<form id="composer">
  <input id="prompt" placeholder="Ask about the codebase\u2026" autocomplete="off" autofocus />
  <button type="submit">Send</button>
</form>
<script>
"use strict";
var root = document.getElementById("messages");
var form = document.getElementById("composer");
var input = document.getElementById("prompt");

// The conversation is held client-side and re-sent in full each turn, so the
// server's /api/chat route stays stateless.
var history = [];

form.addEventListener("submit", function (e) { e.preventDefault(); send(); });

function send() {
  var text = input.value.trim();
  if (!text || input.disabled) return;
  input.value = "";
  setBusy(true);

  var userWrap = addMessage("user");
  block(userWrap, "text").textContent = text;
  history.push({ id: uid(), role: "user", parts: [{ type: "text", text: text }] });

  var aWrap = addMessage("assistant");
  var collected = [];
  streamTurn(aWrap, collected)
    .then(function () {
      history.push({ id: uid(), role: "assistant", parts: [{ type: "text", text: collected.join("") }] });
    })
    .catch(function (err) { block(aWrap, "error").textContent = String(err); })
    .then(function () { setBusy(false); input.focus(); });
}

function streamTurn(wrap, collected) {
  return fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history }),
  }).then(function (res) {
    if (!res.ok || !res.body) throw new Error("request failed: " + res.status);
    var texts = {}, reasons = {}, tools = {};
    return forEachChunk(res.body, function (c) {
      switch (c.type) {
        case "text-start": texts[c.id] = block(wrap, "text"); break;
        case "text-delta":
          (texts[c.id] || (texts[c.id] = block(wrap, "text"))).textContent += c.delta;
          collected.push(c.delta); break;
        case "reasoning-start": reasons[c.id] = block(wrap, "reasoning"); break;
        case "reasoning-delta":
          (reasons[c.id] || (reasons[c.id] = block(wrap, "reasoning"))).textContent += c.delta; break;
        case "tool-input-start":
        case "tool-input-available": {
          var t = tools[c.toolCallId] || (tools[c.toolCallId] = tool(wrap));
          if (c.toolName) t.summary.textContent = "\\uD83D\\uDD27 " + c.toolName;
          if (c.input !== undefined) t.input.textContent = pretty(c.input);
          break;
        }
        case "tool-output-available":
          if (tools[c.toolCallId]) tools[c.toolCallId].output.textContent = pretty(c.output); break;
        case "tool-output-error":
          if (tools[c.toolCallId]) tools[c.toolCallId].output.textContent = "error: " + c.errorText; break;
        case "error": block(wrap, "error").textContent = c.errorText || "stream error"; break;
      }
      root.scrollTop = root.scrollHeight;
    });
  });
}

function forEachChunk(body, onChunk) {
  var reader = body.getReader();
  var decoder = new TextDecoder();
  var buf = "";
  function pump() {
    return reader.read().then(function (r) {
      if (r.done) return;
      buf += decoder.decode(r.value, { stream: true });
      var i;
      while ((i = buf.indexOf("\\n\\n")) !== -1) {
        var frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        var line = frame.indexOf("data: ") === 0 ? frame.slice(6) : frame;
        if (line === "[DONE]") return;
        try { onChunk(JSON.parse(line)); } catch (_) {}
      }
      return pump();
    });
  }
  return pump();
}

function addMessage(role) {
  var w = document.createElement("div");
  w.className = "msg msg-" + role;
  var label = document.createElement("div");
  label.className = "role";
  label.textContent = role;
  w.appendChild(label);
  root.appendChild(w);
  root.scrollTop = root.scrollHeight;
  return w;
}

function block(wrap, cls) {
  var el = document.createElement("div");
  el.className = cls;
  wrap.appendChild(el);
  return el;
}

function tool(wrap) {
  var d = document.createElement("details");
  d.className = "tool";
  var s = document.createElement("summary");
  s.textContent = "\\uD83D\\uDD27 tool";
  var inp = document.createElement("pre");
  var out = document.createElement("pre");
  d.appendChild(s); d.appendChild(inp); d.appendChild(out);
  wrap.appendChild(d);
  return { summary: s, input: inp, output: out };
}

function pretty(v) {
  try { return typeof v === "string" ? v : JSON.stringify(v, null, 2); }
  catch (_) { return String(v); }
}
function uid() { return Math.random().toString(36).slice(2); }
function setBusy(b) { input.disabled = b; form.querySelector("button").disabled = b; }
</script>
</body>
</html>`;

// src/web/sessions.ts
import { mkdir, readFile, readdir, unlink, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
function isValidSessionId(id) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}
function home(env2 = process.env) {
  return env2.CODEBERG_HOME ?? join(homedir(), ".codeberg");
}
function countTurns(messages) {
  return messages.filter((m) => m.role === "user").length;
}
var WebSessionStore = class {
  dir;
  constructor(dir) {
    this.dir = dir ?? join(home(), "web-sessions");
  }
  async save(record) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(
      join(this.dir, `${record.id}.json`),
      JSON.stringify(record, null, 2),
      "utf8"
    );
  }
  async load(id) {
    try {
      const raw = await readFile(join(this.dir, `${id}.json`), "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  /** All sessions, newest first. Corrupt/unreadable files are skipped. */
  async list() {
    let files;
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }
    const summaries = [];
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      const record = await this.load(file.slice(0, -".json".length));
      if (record) {
        summaries.push({
          id: record.id,
          title: record.title,
          updatedAt: record.updatedAt,
          turns: countTurns(record.messages)
        });
      }
    }
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async remove(id) {
    try {
      await unlink(join(this.dir, `${id}.json`));
    } catch {
    }
  }
};

// src/web/server.ts
var CHAT_PATH = "/api/chat";
var META_PATH = "/api/meta";
var SESSIONS_PATH = "/api/sessions";
function createRequestHandler(opts) {
  const respond = opts.respond ?? ((res, messages) => pipeAgentUIStreamToResponse({
    response: res,
    agent: opts.agent,
    uiMessages: messages
  }));
  const sessions = opts.sessionStore ?? new WebSessionStore();
  return (req, res) => {
    route(req, res, opts, respond, sessions).catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      res.end(`internal error: ${String(err)}`);
    });
  };
}
async function route(req, res, opts, respond, sessions) {
  const path = (req.url ?? "/").split("?")[0];
  if (req.method === "POST" && path === CHAT_PATH) {
    const body = await readJson(req);
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    await respond(res, messages);
    return;
  }
  if (req.method === "GET" && path === META_PATH) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ title: opts.title }));
    return;
  }
  if (path === SESSIONS_PATH || path.startsWith(SESSIONS_PATH + "/")) {
    await routeSessions(req, res, sessions, path);
    return;
  }
  if (path.startsWith("/api/")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  if (req.method === "GET") {
    if (await serveStatic(res, opts.staticRoot, path)) {
      return;
    }
    const html = CHAT_PAGE_HTML.replaceAll("{{TITLE}}", escapeHtml(opts.title));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
}
async function routeSessions(req, res, store, path) {
  const rest = decodeURIComponent(path.slice(SESSIONS_PATH.length).replace(/^\//, ""));
  if (rest === "") {
    if (req.method !== "GET") {
      return sendText(res, 405, "method not allowed");
    }
    return sendJson(res, 200, await store.list());
  }
  const id = rest;
  if (!isValidSessionId(id)) {
    return sendText(res, 400, "invalid session id");
  }
  switch (req.method) {
    case "GET": {
      const record = await store.load(id);
      return record ? sendJson(res, 200, record) : sendText(res, 404, "not found");
    }
    case "PUT": {
      const body = await readJson(req);
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      const rawTitle = typeof body?.title === "string" ? body.title.trim() : "";
      const now = Date.now();
      const existing = await store.load(id);
      await store.save({
        id,
        title: rawTitle || "New chat",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        messages
      });
      return sendJson(res, 200, { ok: true });
    }
    case "DELETE": {
      await store.remove(id);
      res.writeHead(204).end();
      return;
    }
    default:
      return sendText(res, 405, "method not allowed");
  }
}
function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
function sendText(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}
async function serveStatic(res, staticRoot, urlPath) {
  if (!staticRoot) {
    return false;
  }
  if (urlPath !== "/") {
    const file = safeJoin(staticRoot, urlPath);
    if (file) {
      try {
        const data = await readFile2(file);
        res.writeHead(200, {
          "Content-Type": contentType(file),
          "Cache-Control": "public, max-age=31536000, immutable"
        });
        res.end(data);
        return true;
      } catch {
      }
    }
  }
  try {
    const html = await readFile2(join2(staticRoot, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return true;
  } catch {
    return false;
  }
}
function createWebServer(opts) {
  return createServer(createRequestHandler(opts));
}
function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const full = resolve(join2(root, decoded));
  const base = resolve(root);
  return full === base || full.startsWith(base + sep) ? full : null;
}
var CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8"
};
function contentType(file) {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}
async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return null;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}
function escapeHtml(s) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

// src/web/main.ts
var DEFAULT_PORT = 48088;
var HOST = "127.0.0.1";
function defaultStaticRoot() {
  return fileURLToPath(new URL("../web-ui/dist", import.meta.url));
}
async function main() {
  const entry = parseEntryArgs(process.argv);
  if (!entry) {
    console.error(entryUsage("codeberg-web"));
    process.exit(1);
  }
  const agent = await createAgentFromEntry(entry).toolLoopAgent();
  const server = createWebServer({
    agent,
    title: `codeberg \xB7 ${entry.modelSpec} \xB7 ${entry.daemonUrl}`,
    staticRoot: process.env.CODEBERG_WEB_ROOT ?? defaultStaticRoot()
  });
  const port = Number(
    process.env.CODEBERG_WEB_PORT ?? process.env.PORT ?? DEFAULT_PORT
  );
  server.listen(port, HOST, () => {
    console.error(`codeberg-web listening on http://${HOST}:${port}`);
  });
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
