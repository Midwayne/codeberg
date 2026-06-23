import { LanguageModel } from 'ai';

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
interface AskResult {
    answer: string;
    sources: SearchResult[];
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
}
declare class Agent {
    private readonly model;
    private readonly daemon;
    private readonly maxSteps;
    private readonly generator;
    constructor(opts: AgentOptions);
    ask(question: string, opts?: SearchOptions): Promise<AskResult>;
    askOnce(question: string, opts?: SearchOptions): Promise<AskResult>;
    private buildTools;
}

declare function fromAiSdk(model: LanguageModel): Generator;

declare const AGENT_SYSTEM = "You are a code-search agent. Use tools iteratively (max rounds) then answer with citations.\n\n- search_code: semantic search \u2014 start here for conceptual questions. Returns path, line range, snippet.\n- grep: exact text/regex over files.\n- glob: find files by pattern.\n- read_file: read file content or a line range.\n- list_dir / tree: explore structure.\n- head / tail / wc: quick file inspection.\n- git_log / git_blame: history (read-only).\n\nStrategy: search_code first; follow up with grep or read_file only when needed. Cite [path:start-end]. Do not guess.";
declare function buildPrompt(question: string, results: {
    path: string;
    symbol: string;
    start_line: number;
    end_line: number;
    snippet: string;
}[]): Prompt;

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
/** Register openai, anthropic, and google when their API keys are set. */
declare function registerBuiltinProviders(registry: {
    register(p: ModelProvider): unknown;
}): void;

declare function defaultProviders(): ProviderRegistry;

export { AGENT_SYSTEM, Agent, type AgentOptions, type AskResult, DaemonClient, type Generator, type ModelProvider, type Prompt, ProviderRegistry, type SearchOptions, type SearchResult, type ToolSpec, anthropicProvider, buildPrompt, defaultProviders, fromAiSdk, googleProvider, openaiProvider, registerBuiltinProviders };
