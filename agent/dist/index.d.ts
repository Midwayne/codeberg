import { LanguageModel, ModelMessage, ToolLoopAgent } from 'ai';

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
 *  ai-sdk v7 `result.finalStep.performance`. Optional: the legacy `askOnce`
 *  path and providers that omit usage leave it undefined. */
interface RunPerformance {
    outputTokensPerSecond?: number;
    responseTimeMs?: number;
}
interface AskResult {
    answer: string;
    sources: SearchResult[];
    performance?: RunPerformance;
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

interface AgentOptions {
    model: LanguageModel;
    daemon: DaemonClient;
    maxSteps?: number;
    generator?: Generator;
    /** Standardized ai-sdk v7 reasoning-effort control, applied to every run. */
    reasoning?: ReasoningEffort;
}
interface AskOptions extends SearchOptions {
    messages?: ModelMessage[];
}
declare class Agent {
    private readonly model;
    private readonly daemon;
    private readonly maxSteps;
    private readonly generator;
    private readonly reasoning?;
    private loop?;
    private sources;
    constructor(opts: AgentOptions);
    ask(question: string, opts?: AskOptions): Promise<AskResult>;
    askOnce(question: string, opts?: AskOptions): Promise<AskResult>;
    /** The underlying ai-sdk v7 agent, for callers that drive their own loop
     *  (e.g. `runAgentTUI`). Built lazily and cached, same instance as `ask`. */
    toolLoopAgent(): Promise<ToolLoopAgent>;
    private ensureLoop;
    private buildTools;
}

declare function fromAiSdk(model: LanguageModel): Generator;

declare const AGENT_SYSTEM = "You are a code-search agent. Use tools iteratively until you have enough evidence to answer, or until the maximum tool rounds are reached. Then answer with citations.\n\nAvailable tools:\n- search_code: semantic search. Start here for conceptual questions, feature questions, ownership questions, and data-source questions. Returns path, line range, and snippet.\n- grep: exact text or regex search over files. Use for symbols, routes, table names, config keys, queue names, event names, endpoint names, imports, and function names.\n- glob: find files by pattern.\n- read_file: read file content or a specific line range.\n- list_dir / tree: explore repository or service structure.\n- head / tail / wc: quick file inspection.\n- git_log / git_blame: inspect history when ownership or recent changes matter. Read-only.\n\nGeneral strategy:\n1. Start with search_code for conceptual discovery.\n2. Use grep to verify exact symbols, routes, functions, classes, table names, config keys, queue/topic names, and imports.\n3. Use read_file to inspect surrounding code before making claims.\n4. Follow imports, function calls, client calls, repository methods, ORM models, queries, and configuration references.\n5. Search across repositories/services when the code indicates microservice boundaries or shared dependencies.\n6. Stop only when you can answer with cited evidence, or when further tracing is blocked by missing code.\n\nData-source tracing strategy:\nWhen the user asks about a data source, storage location, database, table, collection, API dependency, queue, topic, producer, writer, or source of truth, do not stop at the first match.\n\nTrace in this order where possible:\n1. Locate the relevant entry point:\n   - route\n   - controller\n   - handler\n   - resolver\n   - job\n   - worker\n   - command\n   - UI/backend caller\n2. Follow the execution path:\n   - service methods\n   - helper functions\n   - repository/DAO methods\n   - client SDKs\n   - generated clients\n   - shared libraries\n   - adapters\n3. Identify reads:\n   - SELECT/find/get/query/scan\n   - cache reads\n   - external API calls\n   - internal service calls\n   - queue/stream consumption\n4. Identify writes/producers:\n   - INSERT/save/create/update/upsert/delete\n   - ORM persistence calls\n   - database writes\n   - event publishes\n   - queue/topic producers\n   - sync/import jobs\n   - ETL pipelines\n5. Verify storage and schema:\n   - migrations\n   - ORM models\n   - schema files\n   - protobuf/OpenAPI/GraphQL definitions\n   - table/collection constants\n   - database configuration\n6. If an internal API or client is used, search for that API/client implementation in other services.\n7. If a table, collection, topic, or event is found, grep for all writers/producers across repositories.\n8. Separate readers/consumers from writers/producers.\n9. Prefer the deepest confirmed source-of-truth. If the deepest layer is an external system or missing repository, say that explicitly.\n\nRelevance rules:\n- Do not include files merely because they contain the search term.\n- Do not include unrelated APIs that happen to use the same word.\n- A consumer is not a source of truth unless the code shows it produces or persists the data.\n- A schema/model alone is not enough to prove ownership.\n- A client call proves dependency on another service, not the underlying data source.\n- A database read proves where data is read from, not where it originates.\n- A write operation is strong evidence of ownership, but still verify table, collection, topic, or model when possible.\n\nCitation rules:\n- Cite all code claims as [path:start-end].\n- Use citations from read_file or returned search results with exact line ranges.\n- Do not cite files you have not inspected enough to understand.\n- Never make uncited claims about code behavior.\n- If evidence is insufficient, say exactly what was found and what could not be verified.\n\nAnswer format:\nFor normal code questions:\n- Direct answer\n- Supporting evidence with citations\n- Gaps or uncertainty, if any\n\nFor data-source/source-of-truth questions:\n- Direct answer\n- Source map:\n  - Entry point\n  - Read path\n  - Write path / producer\n  - Storage layer\n  - External/internal service dependencies\n  - Other readers/consumers, only if relevant\n  - Gaps / uncertainty\n- Evidence chain with citations\n- Confidence level: High, Medium, or Low, based only on retrieved evidence\n\nDo not guess. Do not rely on repository names, file names, or symbol names alone. Always verify with retrieved code.";
type Chunk = {
    path: string;
    symbol: string;
    start_line: number;
    end_line: number;
    snippet: string;
};
declare function buildPrompt(question: string, results: Chunk[], prior?: ModelMessage[]): Prompt;

interface ChatSessionOptions {
    agent: Agent;
    once?: boolean;
}
declare class ChatSession {
    private readonly agent;
    private readonly once;
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
    once: boolean;
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
/**
 * Register providers whose configuration is present: openai/anthropic/google
 * when their API keys are set, and local ollama always (it needs no API key).
 */
declare function registerBuiltinProviders(registry: {
    register(p: ModelProvider): unknown;
}): void;

declare function defaultProviders(): ProviderRegistry;

export { AGENT_SYSTEM, Agent, type AgentConfig, type AgentOptions, type AskOptions, type AskResult, ChatSession, type ChatSessionOptions, DaemonClient, type EntryConfig, type Generator, type ModelProvider, type Prompt, ProviderRegistry, type ReasoningEffort, type RunPerformance, type SearchOptions, type SearchResult, type ToolSpec, type Turn, anthropicProvider, buildPrompt, createAgent, createAgentFromEntry, defaultProviders, entryUsage, formatSource, formatSources, fromAiSdk, googleProvider, openaiProvider, parseEntryArgs, reasoningFromEnv, registerBuiltinProviders };
