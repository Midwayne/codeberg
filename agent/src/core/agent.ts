import {
  dynamicTool,
  jsonSchema,
  stepCountIs,
  tool,
  ToolLoopAgent,
  type ModelMessage,
  type LanguageModel,
  type ToolSet,
} from 'ai';

import { DaemonClient } from './client.js';
import { fromAiSdk } from './generator.js';
import { AGENT_SYSTEM, buildPrompt } from './prompt.js';
import type {
  AskResult,
  Generator,
  ReasoningEffort,
  RunPerformance,
  SearchOptions,
  SearchResult,
} from './types.js';

const DEFAULT_MAX_STEPS = 16;
const DEFAULT_SEARCH_K = 8;

// Timeout guards (ai-sdk v7 TimeoutConfiguration). They replace the old
// "never stream tool calls" workaround: a wedged gateway now aborts the step
// instead of hanging the whole tool loop. `chunkMs` only bites on the streaming
// path (the runAgentTUI TUI); the CLI runs non-streaming `generate()`.
const DEFAULT_TIMEOUT = {
  totalMs: 300_000,
  stepMs: 120_000,
  chunkMs: 60_000,
} as const;

export interface AgentOptions {
  model: LanguageModel;
  daemon: DaemonClient;
  maxSteps?: number;
  generator?: Generator;
  /** Standardized ai-sdk v7 reasoning-effort control, applied to every run. */
  reasoning?: ReasoningEffort;
}

export interface AskOptions extends SearchOptions {
  messages?: ModelMessage[];
}

export class Agent {
  private readonly model: LanguageModel;
  private readonly daemon: DaemonClient;
  private readonly maxSteps: number;
  private readonly generator: Generator;
  private readonly reasoning?: ReasoningEffort;

  // Built once on first use (tools require an async daemon round-trip), then
  // reused across every ask instead of reconstructing the loop each call.
  private loop?: ToolLoopAgent;
  // Per-ask buffer of the full search hits behind the compact chunks shown to
  // the model. Reset at the top of each `ask`; safe because asks are awaited
  // sequentially (no concurrent runs share this Agent instance).
  private sources: SearchResult[] = [];

  constructor(opts: AgentOptions) {
    this.model = opts.model;
    this.daemon = opts.daemon;
    this.maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
    this.generator = opts.generator ?? fromAiSdk(opts.model);
    this.reasoning = opts.reasoning;
  }

  async ask(question: string, opts: AskOptions = {}): Promise<AskResult> {
    this.sources = [];
    const loop = await this.ensureLoop();
    const messages: ModelMessage[] = [
      ...(opts.messages ?? []),
      { role: "user", content: question },
    ];
    // Non-streaming `generate`: some OpenAI-compatible gateways stall mid-stream
    // when a response carries tool calls; `generate` returns the whole step at
    // once, and the timeout config bounds any stall.
    const result = await loop.generate({ messages });
    return {
      answer: result.text,
      sources: dedupe(this.sources),
      performance: toPerformance(result.finalStep?.performance),
    };
  }

  async askOnce(
    question: string,
    opts: AskOptions = {},
  ): Promise<AskResult> {
    const sources = await this.daemon.search(question, {
      k: opts.k ?? DEFAULT_SEARCH_K,
    });
    const answer = await this.generator.generate(
      buildPrompt(question, sources, opts.messages),
    );
    return { answer, sources };
  }

  /** The underlying ai-sdk v7 agent, for callers that drive their own loop
   *  (e.g. `runAgentTUI`). Built lazily and cached, same instance as `ask`. */
  async toolLoopAgent(): Promise<ToolLoopAgent> {
    return this.ensureLoop();
  }

  private async ensureLoop(): Promise<ToolLoopAgent> {
    if (!this.loop) {
      this.loop = new ToolLoopAgent({
        model: this.model,
        instructions: AGENT_SYSTEM,
        tools: await this.buildTools(),
        stopWhen: stepCountIs(this.maxSteps),
        timeout: DEFAULT_TIMEOUT,
        ...(this.reasoning ? { reasoning: this.reasoning } : {}),
      });
    }
    return this.loop;
  }

  private async buildTools(): Promise<ToolSet> {
    const toolset: ToolSet = {
      search_code: tool({
        description:
          'Semantic code search. Returns relevant chunks with path, lines, and snippet.',
        inputSchema: jsonSchema<{ query: string; k?: number }>({
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string' },
            k: { type: 'number', description: 'max results (default 8)' },
          },
          required: ['query'],
        }),
        execute: async ({ query, k }) => {
          const results = await this.daemon.search(query, {
            k: k ?? DEFAULT_SEARCH_K,
          });
          // Capture the full hits for the answer's source list, but hand the
          // model only the compact chunk shape (token-efficient).
          this.sources.push(...results);
          return results.map(toToolChunk);
        },
      }),
    };

    for (const spec of await this.daemon.listTools()) {
      toolset[spec.name] = dynamicTool({
        description: spec.description,
        inputSchema: jsonSchema(spec.schema),
        execute: async (args) =>
          this.daemon.callTool(spec.name, args as Record<string, unknown>),
      });
    }
    return toolset;
  }
}

function toPerformance(
  perf:
    | { effectiveOutputTokensPerSecond?: number; responseTimeMs?: number }
    | undefined,
): RunPerformance | undefined {
  if (!perf) {
    return undefined;
  }
  return {
    outputTokensPerSecond: perf.effectiveOutputTokensPerSecond,
    responseTimeMs: perf.responseTimeMs,
  };
}

function toToolChunk(r: SearchResult): Record<string, unknown> {
  return {
    id: r.id,
    path: r.path,
    symbol: r.symbol,
    lines: `${r.start_line}-${r.end_line}`,
    snippet: r.snippet,
  };
}

function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<number>();
  const out: SearchResult[] = [];
  for (const r of results) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
    }
  }
  return out;
}
