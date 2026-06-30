import { ModelMessage, LanguageModel, ToolLoopAgent, Instructions, ToolSet } from 'ai';

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
}
declare class Agent implements Asker {
    private readonly model;
    private readonly daemon;
    private readonly maxSteps;
    private readonly generator;
    private readonly reasoning?;
    private readonly profile;
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

export { AGENT_SYSTEM, Agent, type AgentConfig, type AgentOptions, type AskOptions, type AskResult, type Asker, type CacheStrategy, ChatSession, type ChatSessionOptions, DEFAULT_PROFILE, DaemonClient, type EntryConfig, EvidenceLedger, type FitOptions, type Generator, type ModelProfile, type ModelProvider, type Prompt, ProviderRegistry, type ReasoningEffort, type RunPerformance, type SearchOptions, type SearchResult, type Summarize, type ToolSpec, type Turn, anthropicProvider, cachedInstructions, createAgent, createAgentFromEntry, defaultProviders, deterministicTools, entryUsage, estimateTokens, fitHistory, formatSource, formatSources, fromAiSdk, googleProvider, historyBudget, openaiProvider, parseEntryArgs, profileFor, pruneBudget, reasoningFromEnv, registerBuiltinProviders, requestProviderOptions, totalTokens };
