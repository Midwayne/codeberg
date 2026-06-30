import { ModelMessage, ToolLoopAgent, LanguageModel, Instructions, ToolSet } from 'ai';

interface SearchResult {
    id: number;
    path: string;
    symbol: string;
    start_line: number;
    end_line: number;
    score: number;
    snippet: string;
}
interface ToolSpec {
    name: string;
    description: string;
    schema: Record<string, unknown>;
}
interface SearchOptions {
    k?: number;
}
interface Prompt {
    system: string;
    prompt: string;
}
interface Generator {
    generate(prompt: Prompt): Promise<string>;
}
/** Throughput/latency stats for a completed agent run, surfaced from the
 *  ai-sdk v7 `result.finalStep.performance`. Optional: providers that omit
 *  usage leave it undefined. */
interface RunPerformance {
    outputTokensPerSecond?: number;
    responseTimeMs?: number;
}
interface AskResult {
    answer: string;
    sources: SearchResult[];
    performance?: RunPerformance;
}
interface AskOptions extends SearchOptions {
    messages?: ModelMessage[];
}
/** The minimal surface a conversation needs to produce an answer: ask a
 *  question with optional prior turns, get an answer + sources back. `Agent`
 *  satisfies it; `ChatSession` depends on this rather than the concrete agent,
 *  so the conversation logic is testable with a fake. */
interface Asker {
    ask(question: string, opts?: AskOptions): Promise<AskResult>;
}
/** Reasoning-effort levels accepted by ai-sdk v7's standardized `reasoning`
 *  option (`LanguageModelV4CallOptions['reasoning']`). */
type ReasoningEffort = "provider-default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
interface Turn {
    role: "user" | "assistant";
    content: string;
    sources?: SearchResult[];
}

declare class DaemonClient {
    private readonly baseUrl;
    constructor(baseUrl: string);
    search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
    listTools(): Promise<ToolSpec[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

interface PromptHookInput {
    /** The last user message's readable text. */
    text: string;
    /** The full prompt/messages about to be sent to the agent. */
    messages: readonly ModelMessage[];
}
/**
 * Self-description of a hook's slash command, surfaced to UIs for autocomplete
 * and on-hover help. Keeping this on the hook itself makes the hook the single
 * source of truth: registering a new hook automatically lists it in every
 * surface (web SPA, fallback page, `/api/commands`).
 */
interface PromptCommand {
    /** The slash token that triggers the hook, e.g. "/enhance". */
    trigger: string;
    /** Short label for the autocomplete row. */
    title: string;
    /** One-line summary shown inline in the row. */
    summary: string;
    /** Longer explanation shown on hover / in the menu's detail area. */
    description: string;
    /** Optional argument placeholder, e.g. "<request>". */
    argHint?: string;
}
interface PromptHook {
    readonly name: string;
    /** UI-facing metadata for the slash command that triggers this hook. */
    readonly command: PromptCommand;
    rewrite(input: PromptHookInput): string | undefined;
}

/**
 * The slash-command catalog for a set of hooks — the list surfaced to UIs for
 * autocomplete and on-hover help. Defaults to the built-in hooks so every
 * surface stays in sync with what the agent actually runs.
 */
declare function promptCommandCatalog(hooks?: readonly PromptHook[]): PromptCommand[];

declare const DEFAULT_PROMPT_HOOKS: readonly PromptHook[];

/**
 * `/enhance <prompt>` turns a rough user request into a copy-pasteable agent
 * brief. It still flows through the normal tool loop, so the model can search
 * the codebase first and include concrete impacted files/symbols/verification.
 */
declare const enhancePromptHook: PromptHook;

declare function applyPromptHooksToMessages(messages: ModelMessage[], hooks?: readonly PromptHook[]): ModelMessage[];
declare function applyPromptHooksToText(text: string, hooks?: readonly PromptHook[]): string;
declare function wrapToolLoopAgentWithPromptHooks(loop: ToolLoopAgent, hooks?: readonly PromptHook[]): ToolLoopAgent;

/** Resolved web-access configuration for the agent. Web use is on by default
 *  (CODEBERG_WEB_USE); `web_search` additionally needs a SearXNG endpoint. */
interface WebConfig {
    /** Master switch (CODEBERG_WEB_USE). When false, no web tools are registered. */
    enabled: boolean;
    /** SearXNG base URL for web_search (CODEBERG_SEARXNG_URL). Empty disables search. */
    searxngUrl: string;
    /** Max bytes read from a fetched response body (bounds network + parse cost). */
    maxBytes: number;
    /** Max characters of extracted text returned to the model (bounds tokens). */
    maxChars: number;
    /** Per-request timeout in milliseconds. */
    timeoutMs: number;
    /** Default number of search results to return. */
    searchCount: number;
    /** Allow fetching private/loopback hosts (CODEBERG_WEB_ALLOW_PRIVATE). */
    allowPrivate: boolean;
}
/** A single web-search hit (provider-agnostic shape). */
interface WebSearchResult {
    title: string;
    url: string;
    snippet: string;
}
/** The readable form of a fetched page or text resource. */
interface WebPage {
    /** Final URL after redirects. */
    url: string;
    /** Page <title>, when present. */
    title: string;
    /** Extracted, whitespace-normalized text. */
    text: string;
    /** True when the body or text was cut to fit the byte/char caps. */
    truncated: boolean;
}
/** Injectable network seam so the web tools are testable without real HTTP. */
interface WebDeps {
    fetchImpl: typeof fetch;
}

/** Per-model "memory limits" plus the prompt-caching strategy the context
 *  manager keys off. Resolved from the "provider:model" spec so every layer
 *  (history budgeting, in-loop pruning, cache hints) reasons in one model's
 *  terms instead of guessing. The context windows below are conservative
 *  defaults; override any of them with CODEBERG_CONTEXT_WINDOW when running a
 *  model whose window we can't infer — most importantly the local ollama /
 *  llamacpp servers, where the window is whatever was loaded (`-c`, modelfile)
 *  and a wrong guess means silent truncation. */
type CacheStrategy = "anthropic" | "openai" | "none";
interface ModelProfile {
    provider: string;
    modelId: string;
    /** Total context window in tokens — the model's hard memory limit. */
    contextWindow: number;
    /** How the frozen prefix (system + tools) is marked for prompt caching. */
    cache: CacheStrategy;
}
declare function profileFor(spec: string, env?: NodeJS.ProcessEnv): ModelProfile;
/** A permissive profile for callers that don't resolve a spec (tests, the
 *  legacy single-shot path): no caching, effectively unbounded budget. */
declare const DEFAULT_PROFILE: ModelProfile;
declare function historyBudget(profile: ModelProfile): number;
declare function pruneBudget(profile: ModelProfile): number;

interface AgentOptions {
    model: LanguageModel;
    daemon: DaemonClient;
    maxSteps?: number;
    generator?: Generator;
    /** Standardized ai-sdk v7 reasoning-effort control, applied to every run. */
    reasoning?: ReasoningEffort;
    /** Memory-limit + caching profile for the model. Drives prompt caching,
     *  history compaction, and in-loop pruning. Defaults to an uncapped,
     *  cache-less profile so callers without a spec behave as before. */
    profile?: ModelProfile;
    /** Last-user-message rewrites such as `/enhance`. Pass [] to disable. */
    promptHooks?: readonly PromptHook[];
    /** Web-access configuration (web_search + fetch_url). Defaults to the
     *  environment (CODEBERG_WEB_USE on by default). Pass `{ enabled: false, … }`
     *  to disable web tools entirely. */
    web?: WebConfig;
}
declare class Agent implements Asker {
    private readonly model;
    private readonly daemon;
    private readonly maxSteps;
    private readonly generator;
    private readonly reasoning?;
    private readonly profile;
    private readonly promptHooks;
    private readonly web;
    /** System prompt for this agent — `AGENT_SYSTEM` plus a web-tools section when
     *  web use is enabled. Computed once so the cached prefix stays byte-stable. */
    private readonly system;
    private loop?;
    private sources;
    private readonly ledger;
    constructor(opts: AgentOptions);
    ask(question: string, opts?: AskOptions): Promise<AskResult>;
    /** Compact a transcript to fit this model's history budget, summarizing the
     *  overflow with the model itself. Exposed so the TUI session wrapper can
     *  apply the same policy to its own (separately driven) transcript. */
    compactHistory(messages: ModelMessage[]): Promise<ModelMessage[]>;
    /** Bound compactor for callers that drive the loop directly (the TUI). */
    historyCompactor(): (messages: ModelMessage[]) => Promise<ModelMessage[]>;
    private summarize;
    /** The underlying ai-sdk v7 agent, for callers that drive their own loop
     *  (e.g. `runAgentTUI`). Built lazily and cached, same instance as `ask`. */
    toolLoopAgent(): Promise<ToolLoopAgent>;
    private ensureLoop;
    private buildTools;
}

/**
 * Wrap the large, frozen system prompt so the provider caches it instead of
 * re-billing it on every tool round and every turn. Anthropic needs an explicit
 * `cacheControl` breakpoint (1h TTL survives the gaps between turns); OpenAI
 * caches matching prefixes automatically, so there the system prompt stays a
 * plain string and the cache key is pinned on the request options instead.
 * Either way the prompt text is byte-identical across calls - the precondition
 * for any prefix cache to hit.
 */
declare function cachedInstructions(system: string, profile: ModelProfile): Instructions;
/**
 * Request-level provider options for the agent loop. For OpenAI(-compatible)
 * models we pin a stable `promptCacheKey` derived from the cacheable prefix so
 * the automatic prefix cache is hit reliably across turns. Returns undefined
 * when the model has no key-based caching to configure.
 */
declare function requestProviderOptions(system: string, toolNames: string[], profile: ModelProfile): Record<string, Record<string, string>> | undefined;
/**
 * Tool order is part of the cached prefix: a reordered tool list invalidates
 * the whole cache. The daemon's tool list has no guaranteed order, so sort by
 * name to keep the prefix byte-stable across runs and processes.
 */
declare function deterministicTools(tools: ToolSet): ToolSet;

/**
 * A running ledger of code the agent has already retrieved this conversation,
 * injected as a compact block so the model reasons over prior findings instead
 * of re-issuing the same searches every turn — "best info at the ready" without
 * re-paying for the full snippets. Deduped by chunk id and bounded so the
 * ledger itself never crowds out the context window.
 */
declare class EvidenceLedger {
    private readonly seen;
    private readonly max;
    constructor(max?: number);
    add(results: readonly SearchResult[]): void;
    get size(): number;
    /** One line per chunk (path:lines symbol), most recent first. Bounded to
     *  `max` rows. Returns null when empty so callers can skip injection. */
    render(): string | null;
}

declare function fromAiSdk(model: LanguageModel): Generator;

/** Rough token estimate. We don't ship a tokenizer (it would be provider-
 *  specific and a build-time dependency); ~4 chars/token is close enough to
 *  decide *when* to compact, which is all the budget math needs. */
declare function estimateTokens(text: string): number;
declare function totalTokens(messages: readonly ModelMessage[]): number;
type Summarize = (transcript: string) => Promise<string>;
interface FitOptions {
    /** Estimated-token ceiling for the returned transcript. */
    budget: number;
    /** Turns at the tail kept verbatim no matter what (recency). */
    keepRecent?: number;
    /** When provided, overflow is folded into one summary turn; otherwise the
     *  oldest turns are dropped behind a short marker. */
    summarize?: Summarize;
}
/**
 * Bring `messages` under `budget` (estimated tokens). The most recent
 * `keepRecent` messages are always preserved; everything older is either folded
 * into a single leading summary (when a summarizer is supplied) or dropped
 * behind a marker. Returns the input array unchanged when it already fits, so
 * the cacheable prefix is preserved on the common path.
 */
declare function fitHistory(messages: ModelMessage[], opts: FitOptions): Promise<ModelMessage[]>;

declare const AGENT_SYSTEM = "You are a code-search agent. Use tools iteratively until you have enough evidence to answer, or until the maximum tool rounds are reached. Then answer with citations.\n\nAvailable tools:\n- search_code: semantic search. Start here for conceptual questions, feature questions, ownership questions, and data-source questions. Returns path, line range, and snippet.\n- grep: exact text or regex search over files. Use for symbols, routes, table names, config keys, queue names, event names, endpoint names, imports, and function names.\n- glob: find files by pattern.\n- read_file: read file content or a specific line range.\n- list_dir / tree: explore repository or service structure.\n- head / tail / wc: quick file inspection.\n- pipe: run a read-only shell-style pipeline in ONE call, chaining rg/grep with filters (head, tail, wc, sort, uniq, cut, tr, nl, cat, paste, sed) using \"|\". Prefer this to combine a search with filtering \u2014 e.g. `rg -l 'func main' --glob '*.go' | head -20` or `rg TODO | wc -l` \u2014 instead of issuing separate grep + head/wc calls. No shell is run, so redirection, \";\", \"&\", and \"$()\" are rejected and paths cannot escape the repo.\n- git_log / git_blame: inspect history when ownership or recent changes matter. Read-only.\n\nGeneral strategy:\n1. Start with search_code for conceptual discovery.\n2. Use grep to verify exact symbols, routes, functions, classes, table names, config keys, queue/topic names, and imports.\n3. Use read_file to inspect surrounding code before making claims.\n4. Follow imports, function calls, client calls, repository methods, ORM models, queries, and configuration references.\n5. Search across repositories/services when the code indicates microservice boundaries or shared dependencies.\n6. Prefer a single pipe call over several grep/read_file/head/wc calls when the work is expressible as a pipeline \u2014 it is faster and uses fewer tokens.\n7. Stop only when you can answer with cited evidence, or when further tracing is blocked by missing code.\n\nData-source tracing strategy:\nWhen the user asks about a data source, storage location, database, table, collection, API dependency, queue, topic, producer, writer, or source of truth, do not stop at the first match.\n\nTrace in this order where possible:\n1. Locate the relevant entry point:\n   - route\n   - controller\n   - handler\n   - resolver\n   - job\n   - worker\n   - command\n   - UI/backend caller\n2. Follow the execution path:\n   - service methods\n   - helper functions\n   - repository/DAO methods\n   - client SDKs\n   - generated clients\n   - shared libraries\n   - adapters\n3. Identify reads:\n   - SELECT/find/get/query/scan\n   - cache reads\n   - external API calls\n   - internal service calls\n   - queue/stream consumption\n4. Identify writes/producers:\n   - INSERT/save/create/update/upsert/delete\n   - ORM persistence calls\n   - database writes\n   - event publishes\n   - queue/topic producers\n   - sync/import jobs\n   - ETL pipelines\n5. Verify storage and schema:\n   - migrations\n   - ORM models\n   - schema files\n   - protobuf/OpenAPI/GraphQL definitions\n   - table/collection constants\n   - database configuration\n6. If an internal API or client is used, search for that API/client implementation in other services.\n7. If a table, collection, topic, or event is found, grep for all writers/producers across repositories.\n8. Separate readers/consumers from writers/producers.\n9. Prefer the deepest confirmed source-of-truth. If the deepest layer is an external system or missing repository, say that explicitly.\n\nRelevance rules:\n- Do not include files merely because they contain the search term.\n- Do not include unrelated APIs that happen to use the same word.\n- A consumer is not a source of truth unless the code shows it produces or persists the data.\n- A schema/model alone is not enough to prove ownership.\n- A client call proves dependency on another service, not the underlying data source.\n- A database read proves where data is read from, not where it originates.\n- A write operation is strong evidence of ownership, but still verify table, collection, topic, or model when possible.\n\nCitation rules:\n- Cite all code claims as [path:start-end].\n- Use citations from read_file or returned search results with exact line ranges.\n- Do not cite files you have not inspected enough to understand.\n- Never make uncited claims about code behavior.\n- If evidence is insufficient, say exactly what was found and what could not be verified.\n\nAnswer format:\nFor normal code questions:\n- Direct answer\n- Supporting evidence with citations\n- Gaps or uncertainty, if any\n\nFor data-source/source-of-truth questions:\n- Direct answer\n- Source map:\n  - Entry point\n  - Read path\n  - Write path / producer\n  - Storage layer\n  - External/internal service dependencies\n  - Other readers/consumers, only if relevant\n  - Gaps / uncertainty\n- Evidence chain with citations\n- Confidence level: High, Medium, or Low, based only on retrieved evidence\n\nExample of a well-formed data-source answer:\n<example>\n<question>Where do account balances come from?</question>\n<answer>\nAccount balances are read from the Postgres `balances` table by accounts-api, but the source of truth is ledger-worker, which consumes `transactions` events off Kafka and upserts the rolled-up balance.\n\nSource map:\n- Entry point: BalanceController.getBalance [accounts-api/src/controller/BalanceController.java:22-40]\n- Read path: BalanceRepository.findByAccountId -> SELECT on `balances` [accounts-api/src/repo/BalanceRepository.java:15-31]\n- Write path / producer: TransactionConsumer -> LedgerService.applyTransaction upserts the balance [ledger-worker/src/kafka/TransactionConsumer.java:18-44] [ledger-worker/src/service/LedgerService.java:50-78]\n- Storage: Postgres `balances` table [ledger-worker/src/db/migrations/V3__balances.sql:1-12]\n- Other readers: reporting-api reads the same table but never writes it [reporting-api/src/repo/BalanceRepository.java:10-24]\n- Gaps: the producer of the `transactions` events is outside the retrieved code.\n- Confidence: High\n</answer>\n</example>\n\nDo not guess. Do not rely on repository names, file names, or symbol names alone. Always verify with retrieved code.";
/**
 * The system prompt, optionally extended with a web-tools section. Kept as a
 * pure function of the web capability so the cached prefix is byte-stable for a
 * given configuration: when web use is off the prompt is exactly `AGENT_SYSTEM`,
 * and the `web_search` line appears only when a search backend is configured —
 * so the model is never told about a tool that isn't registered.
 */
declare function agentSystemPrompt(web: {
    enabled: boolean;
    search: boolean;
}): string;

/**
 * Fetch an http(s) URL and return its readable text. HTML is reduced to text;
 * plain-text/JSON is passed through; other content types are reported but not
 * decoded. The URL is SSRF-checked first, the body is capped at `maxBytes`, and
 * the extracted text is capped at `maxChars` so a huge page can't blow the
 * context window.
 */
declare function fetchUrl(rawUrl: string, config: WebConfig, deps?: WebDeps): Promise<WebPage>;
/**
 * Search the web via a SearXNG instance (open-source, self-hosted, no API key).
 * Requires `searxngUrl`; the instance must have the JSON output format enabled
 * (`search.formats: [html, json]` in its settings).
 */
declare function searxngSearch(query: string, config: WebConfig, deps?: WebDeps, count?: number): Promise<WebSearchResult[]>;

/**
 * Resolve the agent's web configuration from the environment.
 *
 * - `CODEBERG_WEB_USE` — master switch, **on by default**; set 0/false/off to disable.
 * - `CODEBERG_SEARXNG_URL` — SearXNG base URL that backs `web_search` (no key needed).
 * - `CODEBERG_WEB_ALLOW_PRIVATE` — allow fetching localhost/private hosts (default off).
 * - `CODEBERG_WEB_MAX_BYTES` / `CODEBERG_WEB_MAX_CHARS` / `CODEBERG_WEB_TIMEOUT_MS` /
 *   `CODEBERG_WEB_SEARCH_COUNT` — tuning knobs with sensible defaults.
 */
declare function webConfigFromEnv(env?: NodeJS.ProcessEnv): WebConfig;

interface ExtractedPage {
    title: string;
    text: string;
}
/**
 * A dependency-free "readability-lite": strip non-content elements, turn block
 * boundaries into newlines, remove the remaining tags, decode entities, and
 * normalize whitespace. Not a full DOM parse — good enough to feed page text to
 * the model without pulling in a parser dependency.
 */
declare function htmlToText(html: string): ExtractedPage;

/**
 * Validate a model-supplied URL before fetching it: http/https only, no blocked
 * metadata hosts, and (unless `allowPrivate`) no loopback/private targets.
 * Throws a clear, model-readable error; returns the parsed URL on success.
 */
declare function assertFetchableUrl(raw: string, opts: {
    allowPrivate: boolean;
}): URL;

/**
 * Build the agent's web tools from config. Returns an empty set when web use is
 * disabled. `fetch_url` is always present when enabled (no backend needed);
 * `web_search` only when a SearXNG endpoint is configured. `deps` injects the
 * fetch implementation for tests.
 */
declare function webTools(config: WebConfig, deps?: WebDeps): ToolSet;

interface ChatSessionOptions {
    agent: Asker;
}
declare class ChatSession {
    private readonly agent;
    private readonly turns;
    private readonly listeners;
    constructor(opts: ChatSessionOptions);
    get history(): readonly Turn[];
    subscribe(listener: () => void): () => void;
    ask(question: string): Promise<AskResult>;
    clear(): void;
    private toMessages;
    private notify;
}

interface EntryConfig {
    modelSpec: string;
    question: string;
    daemonUrl: string;
}
declare function parseEntryArgs(argv: string[], env?: NodeJS.ProcessEnv): EntryConfig | null;
declare function entryUsage(program: string): string;

interface AgentConfig {
    modelSpec: string;
    daemonUrl: string;
    reasoning?: ReasoningEffort;
}
/** Read CODEBERG_REASONING, accepting only the ai-sdk v7 effort levels. */
declare function reasoningFromEnv(env?: NodeJS.ProcessEnv): ReasoningEffort | undefined;
declare function createAgent(config: AgentConfig): Agent;
declare function createAgentFromEntry(entry: EntryConfig): Agent;

declare function formatSource(result: SearchResult): string;
declare function formatSources(results: readonly SearchResult[]): string[];

/** Creates an ai-sdk LanguageModel for a provider-specific model id. */
interface ModelProvider {
    readonly name: string;
    model(modelId: string): LanguageModel;
}
/** Registry of named providers; register custom ones alongside defaults. */
declare class ProviderRegistry {
    private readonly providers;
    register(provider: ModelProvider): this;
    get(name: string): ModelProvider | undefined;
    /** Resolve "provider:modelId" (e.g. openai:gpt-4o-mini). */
    resolve(spec: string): LanguageModel;
    list(): string[];
}

declare function openaiProvider(): ModelProvider;
declare function anthropicProvider(): ModelProvider;
declare function googleProvider(): ModelProvider;
declare function registerBuiltinProviders(registry: {
    register(p: ModelProvider): unknown;
}): void;

declare function defaultProviders(): ProviderRegistry;

export { AGENT_SYSTEM, Agent, type AgentConfig, type AgentOptions, type AskOptions, type AskResult, type Asker, type CacheStrategy, ChatSession, type ChatSessionOptions, DEFAULT_PROFILE, DEFAULT_PROMPT_HOOKS, DaemonClient, type EntryConfig, EvidenceLedger, type FitOptions, type Generator, type ModelProfile, type ModelProvider, type Prompt, type PromptCommand, type PromptHook, type PromptHookInput, ProviderRegistry, type ReasoningEffort, type RunPerformance, type SearchOptions, type SearchResult, type Summarize, type ToolSpec, type Turn, type WebConfig, type WebDeps, type WebPage, type WebSearchResult, agentSystemPrompt, anthropicProvider, applyPromptHooksToMessages, applyPromptHooksToText, assertFetchableUrl, cachedInstructions, createAgent, createAgentFromEntry, defaultProviders, deterministicTools, enhancePromptHook, entryUsage, estimateTokens, fetchUrl, fitHistory, formatSource, formatSources, fromAiSdk, googleProvider, historyBudget, htmlToText, openaiProvider, parseEntryArgs, profileFor, promptCommandCatalog, pruneBudget, reasoningFromEnv, registerBuiltinProviders, requestProviderOptions, searxngSearch, totalTokens, webConfigFromEnv, webTools, wrapToolLoopAgentWithPromptHooks };
