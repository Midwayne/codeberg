import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { profileFor } from '../../providers/profiles.js';
import { Agent } from '../agent.js';
import { DaemonClient, DEFAULT_DAEMON_URL } from '../client.js';
import { ContextStore } from '../context/store.js';
import { webConfigFromEnv } from '../web/config.js';

type Call = { name: string; args: Record<string, unknown> };

type Body = Record<string, unknown>;

const LOOKUPS: Call[] = [
  { name: 'grep', args: { pattern: 'cberg_chunker_open' } },
  { name: 'grep', args: { pattern: 'cberg_embed' } },
  { name: 'read_file', args: { path: 'core/src/chunk.c' } },
];

const ANSWER = 'Chunking starts in core/src/chunk.c.';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** One wire format per provider family: a step with several tool calls, then an answer. */
const WIRE = {
  anthropic: {
    tools: (calls: Call[]) =>
      json({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'm',
        content: calls.map((c, i) => ({
          type: 'tool_use',
          id: `t${i}`,
          name: c.name,
          input: c.args,
        })),
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    answer: () =>
      json({
        id: 'msg_2',
        type: 'message',
        role: 'assistant',
        model: 'm',
        content: [{ type: 'text', text: ANSWER }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
  },
  responses: {
    tools: (calls: Call[]) =>
      responsesBody(
        calls.map((c, i) => ({
          type: 'function_call',
          id: `fc_${i}`,
          call_id: `call_${i}`,
          name: c.name,
          arguments: JSON.stringify(c.args),
          status: 'completed',
        })),
      ),
    answer: () =>
      responsesBody([
        {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: ANSWER, annotations: [] }],
        },
      ]),
  },
  chat: {
    tools: (calls: Call[]) =>
      chatBody(
        {
          role: 'assistant',
          content: null,
          tool_calls: calls.map((c, i) => ({
            id: `call_${i}`,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        },
        'tool_calls',
      ),
    answer: () => chatBody({ role: 'assistant', content: ANSWER }, 'stop'),
  },
  google: {
    tools: (calls: Call[]) =>
      googleBody(calls.map((c) => ({ functionCall: { name: c.name, args: c.args } }))),
    answer: () => googleBody([{ text: ANSWER }]),
  },
} as const;

function responsesBody(output: unknown[]) {
  return json({
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    model: 'm',
    status: 'completed',
    output,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  });
}

function chatBody(message: unknown, finish: string) {
  return json({
    id: 'chat_1',
    object: 'chat.completion',
    created: 1,
    model: 'm',
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function googleBody(parts: unknown[]) {
  return json({
    candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  });
}

type Wire = (typeof WIRE)[keyof typeof WIRE];

function scripted(wire: Wire, calls: Call[], bodies: Body[]) {
  const replies = [wire.tools(calls), wire.answer()];

  return vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)) as Body);

    return replies.shift()!;
  }) as unknown as typeof globalThis.fetch;
}

const PROVIDERS: Record<string, (fetch: typeof globalThis.fetch) => LanguageModel> = {
  anthropic: (fetch) => createAnthropic({ apiKey: 'k', fetch })('claude-opus-4-8'),
  openai: (fetch) => createOpenAI({ apiKey: 'k', fetch })('gpt-5'),
  google: (fetch) => createGoogleGenerativeAI({ apiKey: 'k', fetch })('gemini-2.5-pro'),
  ollama: (fetch) => createOpenAI({ apiKey: 'k', baseURL: 'http://x/v1', fetch }).chat('qwen3'),
  llamacpp: (fetch) => createOpenAI({ apiKey: 'k', baseURL: 'http://x/v1', fetch }).chat('local'),
};

const WIRE_FOR: Record<string, Wire> = {
  anthropic: WIRE.anthropic,
  openai: WIRE.responses,
  google: WIRE.google,
  ollama: WIRE.chat,
  llamacpp: WIRE.chat,
};

function concurrentDaemon(log: { active: number; peak: number; calls: string[] }) {
  const daemon = new DaemonClient(DEFAULT_DAEMON_URL);

  vi.spyOn(daemon, 'waitReady').mockResolvedValue({
    ready: true,
    chunks: 0,
    version: 'test',
    vectors_enabled: false,
  });

  const schema = {
    type: 'object',
    properties: { pattern: { type: 'string' }, path: { type: 'string' } },
  };
  vi.spyOn(daemon, 'listTools').mockResolvedValue([
    { name: 'grep', description: 'Search files', schema },
    { name: 'read_file', description: 'Read a file', schema },
  ]);

  vi.spyOn(daemon, 'callTool').mockImplementation(async (name, args) => {
    log.calls.push(`${name} ${JSON.stringify(args)}`);
    log.active++;
    log.peak = Math.max(log.peak, log.active);

    await new Promise((resolve) => setTimeout(resolve, 25));

    log.active--;

    return [{ path: 'core/src/chunk.c', line: 12 }];
  });

  return daemon;
}

async function askWith(provider: string, calls: Call[]) {
  const bodies: Body[] = [];
  const log = { active: 0, peak: 0, calls: [] as string[] };

  const agent = new Agent({
    model: PROVIDERS[provider]!(scripted(WIRE_FOR[provider]!, calls, bodies)),
    daemon: concurrentDaemon(log),
    learning: false,
    profile: profileFor(`${provider}:model`, {}),
    promptHooks: [],
    web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }),
    mcp: { enabled: false, servers: [], files: [], warnings: [] },
    context: ContextStore.open(mkdtempSync(join(tmpdir(), `cberg-parallel-${provider}-`))),
  });

  const result = await agent.ask('where does chunking start?');
  await agent.close();

  return { result, bodies, log };
}

function toolNames(body: Body): string[] {
  const tools = (body.tools ?? []) as Record<string, unknown>[];

  const google = tools.flatMap(
    (t) => (t.functionDeclarations as { name: string }[] | undefined)?.map((d) => d.name) ?? [],
  );

  const named = tools.map((t) => (t.name ?? (t.function as { name?: string })?.name) as string);

  return [...google, ...named].filter(Boolean);
}

describe.each(Object.keys(PROVIDERS))('parallel tool calls on %s', (provider) => {
  it('runs every call from one response concurrently, in a single step', async () => {
    const { result, bodies, log } = await askWith(provider, LOOKUPS);

    expect(result.answer).toBe(ANSWER);
    expect(bodies).toHaveLength(2);
    expect(log.calls).toHaveLength(3);
    expect(log.peak).toBe(3);

    const second = JSON.stringify(bodies[1]);
    for (const lookup of LOOKUPS) {
      expect(second).toContain(String(Object.values(lookup.args)[0]));
    }
  });

  it('asks for parallel calls in the prompt and on the wire', async () => {
    const { bodies } = await askWith(provider, LOOKUPS);

    expect(JSON.stringify(bodies[0])).toContain(
      'Put every independent tool call in the same response',
    );

    const openAiWire = ['openai', 'ollama', 'llamacpp'].includes(provider);
    expect(bodies[0]!.parallel_tool_calls).toBe(openAiWire ? true : undefined);
  });
});

describe('batch fallback', () => {
  it.each(['ollama', 'llamacpp'])(
    'is offered to %s, which may return one call per response',
    async (provider) => {
      const batch: Call = {
        name: 'batch',
        args: { calls: LOOKUPS.map((l) => ({ tool: l.name, args: l.args })) },
      };

      const { result, bodies, log } = await askWith(provider, [batch]);

      expect(result.answer).toBe(ANSWER);
      expect(toolNames(bodies[0]!)).toContain('batch');
      expect(JSON.stringify(bodies[0])).toContain('Batch tool:');
      expect(bodies).toHaveLength(2);
      expect(log.peak).toBe(3);
    },
  );

  it.each(['anthropic', 'openai', 'google'])('is not registered for %s', async (provider) => {
    const { bodies } = await askWith(provider, LOOKUPS);

    expect(toolNames(bodies[0]!)).toContain('grep');
    expect(toolNames(bodies[0]!)).not.toContain('batch');
    expect(JSON.stringify(bodies[0])).not.toContain('Batch tool:');
  });
});
