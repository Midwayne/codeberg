#!/usr/bin/env node

// src/core/agent.ts
import {
  dynamicTool,
  jsonSchema,
  stepCountIs,
  tool,
  ToolLoopAgent
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
    const text = textOf(m.content);
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
function textOf(content) {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) => part.type === "text" ? part.text : "").join("").trim();
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
  // Built once on first use (tools require an async daemon round-trip), then
  // reused across every ask instead of reconstructing the loop each call.
  loop;
  // Per-ask buffer of the full search hits behind the compact chunks shown to
  // the model. Reset at the top of each `ask`; safe because asks are awaited
  // sequentially (no concurrent runs share this Agent instance).
  sources = [];
  constructor(opts) {
    this.model = opts.model;
    this.daemon = opts.daemon;
    this.maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
    this.generator = opts.generator ?? fromAiSdk(opts.model);
    this.reasoning = opts.reasoning;
  }
  async ask(question, opts = {}) {
    this.sources = [];
    const loop = await this.ensureLoop();
    const messages = [
      ...opts.messages ?? [],
      { role: "user", content: question }
    ];
    const result = await loop.generate({ messages });
    return {
      answer: result.text,
      sources: dedupe(this.sources),
      performance: toPerformance(result.finalStep?.performance)
    };
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
      this.loop = new ToolLoopAgent({
        model: this.model,
        instructions: AGENT_SYSTEM,
        tools: await this.buildTools(),
        stopWhen: stepCountIs(this.maxSteps),
        timeout: DEFAULT_TIMEOUT,
        ...this.reasoning ? { reasoning: this.reasoning } : {}
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
    reasoning: config.reasoning
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

// src/core/format.ts
function formatSource(result) {
  return `${result.path}:${result.start_line}-${result.end_line} (id=${result.id})`;
}

// src/cli/format.ts
function printResult(result) {
  console.log(result.answer);
  if (result.sources.length > 0) {
    console.error("\n--- sources ---");
    for (const s of result.sources) {
      console.error(formatSource(s));
    }
  }
  const perf = formatPerformance(result.performance);
  if (perf) {
    console.error(`
${perf}`);
  }
}
function formatPerformance(perf) {
  if (!perf) {
    return void 0;
  }
  const parts = [];
  if (perf.outputTokensPerSecond != null) {
    parts.push(`${perf.outputTokensPerSecond.toFixed(1)} tok/s`);
  }
  if (perf.responseTimeMs != null) {
    parts.push(`${(perf.responseTimeMs / 1e3).toFixed(1)}s`);
  }
  return parts.length > 0 ? `--- ${parts.join(" \xB7 ")} ---` : void 0;
}

// src/cli/main.ts
async function main() {
  const entry = parseEntryArgs(process.argv);
  if (!entry?.question) {
    console.error(entryUsage("codeberg-ask"));
    process.exit(1);
  }
  const session = new ChatSession({
    agent: createAgentFromEntry(entry),
    // Preserve current behavior: always use the multi-step `ask` flow,
    // ignoring `--once` (askOnce) as the pre-TUI CLI did.
    // once: entry.once,
    once: false
  });
  const result = await session.ask(entry.question);
  printResult(result);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
