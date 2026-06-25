import {
  dynamicTool,
  generateText,
  jsonSchema,
  stepCountIs,
  tool,
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
  SearchOptions,
  SearchResult,
} from './types.js';

const DEFAULT_MAX_STEPS = 16;
const DEFAULT_SEARCH_K = 8;

export interface AgentOptions {
  model: LanguageModel;
  daemon: DaemonClient;
  maxSteps?: number;
  generator?: Generator;
}

export interface AskOptions extends SearchOptions {
  messages?: ModelMessage[];
}

export class Agent {
  private readonly model: LanguageModel;
  private readonly daemon: DaemonClient;
  private readonly maxSteps: number;
  private readonly generator: Generator;

  constructor(opts: AgentOptions) {
    this.model = opts.model;
    this.daemon = opts.daemon;
    this.maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
    this.generator = opts.generator ?? fromAiSdk(opts.model);
  }

  async ask(question: string, opts: AskOptions = {}): Promise<AskResult> {
    const sources: SearchResult[] = [];
    const messages: ModelMessage[] = [
      ...(opts.messages ?? []),
      { role: "user", content: question },
    ];
    // Must be generateText, not streamText: some OpenAI-compatible gateways
    // hang when streaming a response that contains tool calls, so the
    // multi-step tool loop never completes. generateText returns tool calls in a
    // single (non-streamed) response and works reliably.
    const { text } = await generateText({
      model: this.model,
      system: AGENT_SYSTEM,
      messages,
      tools: await this.buildTools(opts, sources),
      stopWhen: stepCountIs(this.maxSteps),
    });
    return { answer: text, sources: dedupe(sources) };
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

  private async buildTools(
    opts: SearchOptions,
    sink: SearchResult[],
  ): Promise<ToolSet> {
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
            k: k ?? opts.k ?? DEFAULT_SEARCH_K,
          });
          sink.push(...results);
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
