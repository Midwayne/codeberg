import { simulateStreamingMiddleware, wrapLanguageModel, type ModelMessage } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent } from './agent.js';
import { DaemonClient, DEFAULT_DAEMON_URL } from './client.js';
import { ContextStore } from './context/store.js';
import type { Generator } from './types.js';
import { webConfigFromEnv } from './web/config.js';
import type { ModelProfile } from '../providers/profiles.js';

// contextWindow 2000 -> history budget 1000 tokens (~4000 chars).
const smallWindow: ModelProfile = {
  provider: 'test',
  modelId: 'test',
  contextWindow: 2000,
  cache: 'none',
};

function agentWith(generator: Generator): Agent {
  return new Agent({
    model: {} as never,
    daemon: new DaemonClient(DEFAULT_DAEMON_URL),
    generator,
    profile: smallWindow,
    context: ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-ctx-'))),
  });
}

describe('Agent.compactHistory', () => {
  it('returns history unchanged when it fits the budget', async () => {
    const summarize = vi.fn(async () => 'SUMMARY');
    const agent = agentWith({ generate: summarize });
    const messages: ModelMessage[] = [
      { role: 'user', content: 'short' },
      { role: 'assistant', content: 'answer' },
    ];
    const out = await agent.compactHistory(messages);
    expect(out).toBe(messages);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('summarizes older turns once the transcript exceeds the window', async () => {
    const summarize = vi.fn(async () => 'SUMMARY');
    const agent = agentWith({ generate: summarize });
    const turn = 'x'.repeat(600); // ~150 tokens each
    const messages: ModelMessage[] = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: turn,
    }));
    const out = await agent.compactHistory(messages);
    expect(summarize).toHaveBeenCalledOnce();
    expect(String(out[0]?.content)).toContain('SUMMARY');
    expect(String(out[0]?.content)).toContain('<history_file>');
    expect(out.length).toBeLessThan(messages.length);
  });
});

describe('Agent tool budget', () => {
  it.each(['generate', 'stream'] as const)(
    'finishes with an answer after the last tool result (%s)',
    async (mode) => {
      const model = new MockLanguageModelV4({
        doGenerate: async ({ toolChoice, prompt }) => {
          const answering = toolChoice?.type === 'none';
          if (answering) {
            expect(JSON.stringify(prompt)).toContain('[spilled to ');
            expect(JSON.stringify(prompt)).toContain('tool-round budget');
          }
          return {
            content: answering
              ? [
                  {
                    type: 'text' as const,
                    text: 'Partial findings; the spilled result still needs inspection.',
                  },
                ]
              : [
                  {
                    type: 'tool-call' as const,
                    toolCallId: 'lookup-1',
                    toolName: 'grep',
                    input: '{"pattern":"example"}',
                  },
                ],
            finishReason: {
              unified: answering ? ('stop' as const) : ('tool-calls' as const),
              raw: undefined,
            },
            usage: {
              inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 10, text: 10, reasoning: 0 },
            },
            warnings: [],
          };
        },
      });
      const daemon = new DaemonClient(DEFAULT_DAEMON_URL);
      vi.spyOn(daemon, 'waitReady').mockResolvedValue({
        ready: true,
        chunks: 0,
        version: 'test',
        vectors_enabled: false,
      });
      vi.spyOn(daemon, 'listTools').mockResolvedValue([
        {
          name: 'grep',
          description: 'Search source files',
          schema: {
            type: 'object',
            properties: { pattern: { type: 'string' } },
            required: ['pattern'],
          },
        },
      ]);
      const callTool = vi.spyOn(daemon, 'callTool').mockResolvedValue('evidence '.repeat(2_000));
      const agent = new Agent({
        model: wrapLanguageModel({ model, middleware: simulateStreamingMiddleware() }),
        daemon,
        maxSteps: 1,
        promptHooks: [],
        web: webConfigFromEnv({ CODEBERG_WEB_USE: 'false' }),
        mcp: { enabled: false, servers: [], files: [], warnings: [] },
        context: ContextStore.open(mkdtempSync(join(tmpdir(), 'cberg-budget-'))),
      });
      const loop = await agent.toolLoopAgent();
      let text: string;
      if (mode === 'generate') {
        text = (await loop.generate({ prompt: 'Investigate this' })).text;
      } else {
        const result = await loop.stream({ prompt: 'Investigate this' });
        await result.consumeStream();
        text = await result.text;
      }
      expect(text).toContain('Partial findings');
      expect(callTool).toHaveBeenCalledOnce();
      expect(model.doGenerateCalls).toHaveLength(2);
      expect(model.doGenerateCalls[0]!.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'grep', description: 'Search source files' }),
          expect.objectContaining({ name: 'context_read' }),
          expect.objectContaining({ name: 'context_grep' }),
        ]),
      );
    },
  );
});
