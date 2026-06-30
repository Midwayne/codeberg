#!/usr/bin/env node

// src/tui/main.ts
import { runAgentTUI } from "@ai-sdk/tui";

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

// src/core/message.ts
function messageText(message) {
  const { content } = message;
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) => part.type === "text" ? part.text : "").join("");
}

// src/core/history.ts
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function messageTokens(message) {
  return estimateTokens(messageText(message));
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
    const transcript = older.map((m) => `${m.role}: ${messageText(m)}`).join("\n");
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
  const sep = spec.indexOf(":");
  const provider = sep > 0 ? spec.slice(0, sep) : "";
  const modelId = sep > 0 ? spec.slice(sep + 1) : spec;
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
function requireEnv(name, provider) {
  const value = env(name);
  if (!value) {
    throw new Error(`${name} is required for the ${provider} provider`);
  }
  return value;
}
function openaiProvider() {
  const openai = createOpenAI({ apiKey: requireEnv("OPENAI_API_KEY", "openai") });
  return { name: "openai", model: (id) => openai(id) };
}
function anthropicProvider() {
  const anthropic = createAnthropic({
    apiKey: requireEnv("ANTHROPIC_API_KEY", "anthropic")
  });
  return { name: "anthropic", model: (id) => anthropic(id) };
}
function googleProvider() {
  const google = createGoogleGenerativeAI({
    apiKey: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY", "google")
  });
  return { name: "google", model: (id) => google(id) };
}
function openAICompatible(opts) {
  const client = createOpenAI({
    baseURL: env(opts.baseURLEnv) ?? opts.baseURLDefault,
    apiKey: env(opts.keyEnv) ?? opts.keyDefault
  });
  return { name: opts.name, model: (id) => client.chat(id) };
}
function ollamaProvider() {
  return openAICompatible({
    name: "ollama",
    baseURLEnv: "OLLAMA_BASE_URL",
    baseURLDefault: "http://localhost:11434/v1",
    keyEnv: "OLLAMA_API_KEY",
    keyDefault: "ollama"
  });
}
function llamacppProvider() {
  return openAICompatible({
    name: "llamacpp",
    baseURLEnv: "LLAMACPP_BASE_URL",
    baseURLDefault: "http://localhost:8080/v1",
    keyEnv: "LLAMACPP_API_KEY",
    keyDefault: "llama.cpp"
  });
}
var BUILTIN = [
  openaiProvider,
  anthropicProvider,
  googleProvider,
  ollamaProvider,
  llamacppProvider
];
function registerBuiltinProviders(registry) {
  for (const make of BUILTIN) {
    try {
      registry.register(make());
    } catch {
    }
  }
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
  const rest = argv.slice(2);
  const modelSpec = env2.CODEBERG_MODEL ?? rest[0] ?? "";
  const question = env2.CODEBERG_QUESTION ?? (modelSpec === rest[0] ? rest.slice(1).join(" ") : rest.join(" "));
  if (!modelSpec.includes(":")) {
    return null;
  }
  return {
    modelSpec,
    question,
    daemonUrl: env2.CODEBERG_DAEMON_URL ?? DEFAULT_DAEMON_URL
  };
}
function entryUsage(program) {
  return `Usage: ${program} [provider:model] <question>
Env: CODEBERG_DAEMON_URL (default http://127.0.0.1:8080)
     CODEBERG_MODEL=openai:gpt-4o-mini
Providers: openai, anthropic, google (when API keys set)`;
}

// src/tui/session-store.ts
import { randomBytes } from "crypto";
import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
function home(env2 = process.env) {
  if (env2.CODEBERG_HOME) {
    return env2.CODEBERG_HOME;
  }
  return join(homedir(), ".codeberg");
}
function countTurns(messages) {
  return messages.filter((m) => m.role === "user").length;
}
var SessionStore = class {
  dir;
  constructor(dir) {
    this.dir = dir ?? join(home(), "sessions");
  }
  /** A short, file-safe id. Injectable in tests via `save`-provided ids. */
  static newId() {
    return randomBytes(3).toString("hex");
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
  /**
   * Resolve a user-typed id to a stored session: exact match first, then a
   * unique prefix. Returns null when nothing matches or a prefix is ambiguous.
   */
  async resolve(idOrPrefix) {
    const exact = await this.load(idOrPrefix);
    if (exact) {
      return exact;
    }
    const matches = (await this.list()).filter(
      (s) => s.id.startsWith(idOrPrefix)
    );
    if (matches.length !== 1) {
      return null;
    }
    return this.load(matches[0].id);
  }
};

// src/tui/commands.ts
var COMMANDS = [
  { usage: "/help", summary: "show this list of commands" },
  { usage: "/sessions", summary: "list saved chats you can resume" },
  { usage: "/resume <id>", summary: "resume a saved chat by id" },
  { usage: "/new", summary: "start a fresh chat (clears context)" }
];
function parseCommand(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  if (trimmed === "/") {
    return { kind: "help" };
  }
  const [verb, ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  switch (verb.toLowerCase()) {
    case "help":
    case "?":
      return { kind: "help" };
    case "sessions":
    case "list":
      return { kind: "sessions" };
    case "resume":
    case "continue":
      return { kind: "resume", arg };
    case "new":
    case "clear":
      return { kind: "new" };
    default:
      return null;
  }
}
function stripCommandTurns(messages) {
  const out = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === "user" && parseCommand(messageText(message))) {
      if (messages[i + 1]?.role === "assistant") {
        i++;
      }
      continue;
    }
    out.push(message);
  }
  return out;
}
function formatHelp() {
  const width = Math.max(...COMMANDS.map((c) => c.usage.length));
  const lines = COMMANDS.map(
    (c) => `  ${c.usage.padEnd(width)}  ${c.summary}`
  );
  return ["Commands:", ...lines].join("\n");
}
function formatSessionList(sessions, now = Date.now()) {
  if (sessions.length === 0) {
    return "No saved sessions yet. Ask a question to start one.";
  }
  const idWidth = Math.max(...sessions.map((s) => s.id.length));
  const lines = sessions.map((s) => {
    const turns = `${s.turns} turn${s.turns === 1 ? "" : "s"}`;
    return `  ${s.id.padEnd(idWidth)}  ${quote(s.title)}  \xB7  ${relativeTime(
      s.updatedAt,
      now
    )}  \xB7  ${turns}`;
  });
  return [
    "Saved sessions (most recent first):",
    "",
    ...lines,
    "",
    "Type /resume <id> to continue one."
  ].join("\n");
}
function quote(title) {
  const clean = title.replace(/\s+/g, " ").trim();
  const short = clean.length > 48 ? `${clean.slice(0, 47)}\u2026` : clean;
  return `"${short || "(untitled)"}"`;
}
function relativeTime(then, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - then) / 1e3));
  if (seconds < 45) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(then).toISOString().slice(0, 10);
}
function deriveTitle(messages) {
  const firstUser = messages.find((m) => m.role === "user");
  const text = firstUser ? messageText(firstUser).replace(/\s+/g, " ").trim() : "";
  if (!text) {
    return "(untitled)";
  }
  return text.length > 60 ? `${text.slice(0, 59)}\u2026` : text;
}

// src/tui/session-agent.ts
function wrapSessionAgent(loop, opts) {
  const now = opts.now ?? (() => Date.now());
  const newId = opts.newId ?? SessionStore.newId;
  const state = {
    sessionId: newId(),
    /** History prepended to every turn after a `/resume`. */
    resumed: [],
    /**
     * Index into the runner's append-only transcript before which messages are
     * ignored. Bumped past a `/new` or `/resume` command (and the synthetic
     * reply the runner appends right after) so earlier on-screen turns drop out
     * of model context.
     */
    dropBefore: 0,
    title: void 0,
    createdAt: now()
  };
  async function runCommand(command, raw) {
    switch (command.kind) {
      case "help":
        return formatHelp();
      case "sessions":
        return formatSessionList(await opts.store.list(), now());
      case "new":
        state.sessionId = newId();
        state.resumed = [];
        state.title = void 0;
        state.createdAt = now();
        state.dropBefore = raw.length + 1;
        return "Started a fresh session. Earlier turns are no longer in context.";
      case "resume": {
        if (!command.arg) {
          return "Usage: /resume <id>. Run /sessions to see saved ids.";
        }
        const record = await opts.store.resolve(command.arg);
        if (!record) {
          return `No session matches "${command.arg}". Run /sessions to see saved ids.`;
        }
        state.sessionId = record.id;
        state.resumed = stripCommandTurns(record.messages);
        state.title = record.title;
        state.createdAt = record.createdAt;
        state.dropBefore = raw.length + 1;
        const turns = state.resumed.filter((m) => m.role === "user").length;
        return `Resumed "${record.title}" \u2014 ${turns} prior turn${turns === 1 ? "" : "s"} now in context.`;
      }
    }
  }
  async function persist(messages) {
    if (messages.length === 0) {
      return;
    }
    state.title ??= deriveTitle(messages);
    try {
      await opts.store.save({
        id: state.sessionId,
        title: state.title,
        modelSpec: opts.modelSpec,
        createdAt: state.createdAt,
        updatedAt: now(),
        messages
      });
    } catch {
    }
  }
  const streamOverride = async (params) => {
    const raw = toModelMessages(params.prompt);
    const last = lastUserMessage(raw);
    const command = last ? parseCommand(messageText(last)) : null;
    if (command) {
      return synthetic(await runCommand(command, raw));
    }
    const current = stripCommandTurns(raw.slice(state.dropBefore));
    const effective = [...state.resumed, ...current];
    const sent = opts.compactor ? await opts.compactor(effective) : effective;
    const result = await loop.stream({
      ...params,
      prompt: sent
    });
    return teeForPersistence(result, effective, persist);
  };
  return new Proxy(loop, {
    get(target, prop) {
      if (prop === "stream") {
        return streamOverride;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
function toModelMessages(prompt) {
  return Array.isArray(prompt) ? prompt : [];
}
function lastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      return messages[i];
    }
  }
  return void 0;
}
function synthetic(text) {
  async function* fullStream() {
    const id = "codeberg-command";
    yield { type: "text-start", id };
    yield { type: "text-delta", id, text };
    yield { type: "text-end", id };
    yield { type: "finish", finishReason: "stop", totalUsage: void 0 };
  }
  return { fullStream: fullStream() };
}
function teeForPersistence(result, effective, persist) {
  const source = result.fullStream;
  async function* observed() {
    let text = "";
    try {
      for await (const part of source) {
        if (part?.type === "text-delta" && typeof part.text === "string") {
          text += part.text;
        }
        yield part;
      }
    } finally {
      const messages = text ? [...effective, { role: "assistant", content: text }] : effective;
      await persist(messages);
    }
  }
  const stream = observed();
  return new Proxy(result, {
    get(target, prop) {
      if (prop === "fullStream") {
        return stream;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

// src/tui/main.ts
async function main() {
  const entry = parseEntryArgs(process.argv);
  if (!entry) {
    console.error(entryUsage("codeberg-tui"));
    process.exit(1);
  }
  const core = createAgentFromEntry(entry);
  const loop = await core.toolLoopAgent();
  const agent = wrapSessionAgent(loop, {
    store: new SessionStore(),
    modelSpec: entry.modelSpec,
    // Same memory-limit-aware compaction the CLI path uses, applied to the
    // TUI's separately-driven transcript.
    compactor: core.historyCompactor()
  });
  await runAgentTUI({
    agent,
    title: `codeberg \xB7 ${entry.modelSpec} \xB7 ${entry.daemonUrl} \xB7 /help for commands`,
    tools: "auto-collapsed",
    reasoning: "auto-collapsed",
    responseStatistics: "outputTokensPerSecond"
  });
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
