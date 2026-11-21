import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { ToolLoopAgent } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chatScope } from '../chat-scope.js';
import { ContextStore } from '../context/store.js';
import { contextReport } from './breakdown.js';
import { estimateRequest } from './estimate.js';
import { manageContextModel } from './model.js';
import { onContextEvent, type ContextEvent } from './report.js';

const profile = { provider: 'test', modelId: 'test', contextWindow: 100_000, cache: 'none' as const };
const roots: string[] = [];
const unsubscribe: (() => void)[] = [];

afterEach(() => {
  for (const stop of unsubscribe.splice(0)) stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function request(): LanguageModelV4CallOptions {
  const result = (toolCallId: string, value: string) => ({
    role: 'tool' as const,
    content: [{ type: 'tool-result' as const, toolCallId, toolName: 'grep', output: { type: 'text' as const, value } }],
  });

  return {
    tools: [{ type: 'function', name: 'grep', description: 'Search files', inputSchema: { type: 'object' } }],
    prompt: [
      { role: 'system', content: 'STABLE RULES '.repeat(40) },
      { role: 'system', content: 'Repositories: api' },
      { role: 'user', content: [{ type: 'text', text: '<conversation_summary>\nEarlier work\n</conversation_summary>\n<history_file>/h.txt</history_file>' }] },
      { role: 'user', content: [{ type: 'text', text: 'where is chunking?' }] },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'grep', input: { pattern: 'chunk' } }] },
      result('a', '[cleared grep result: 4000 chars, saved in /t/a.txt. Read it with context_read or context_grep if you need it again.]'),
      result('b', '[spilled to /t/b.txt — 20000 chars; the middle is only in that file]\n<head>x</head>'),
      result('c', 'core/src/chunk.c:12'),
    ],
  };
}

describe('contextReport', () => {
  it('splits a request into buckets that add up to its estimate', () => {
    const sent = request();
    const report = contextReport(sent, { profile, modelName: 'test:test' }, { stable: 'STABLE RULES '.repeat(40), context: 'Repositories: api' });

    expect(report.estimated).toBe(estimateRequest(sent));
    expect(report.breakdown.instructions).toBeGreaterThan(report.breakdown.context);
    expect(report.breakdown.context).toBeGreaterThan(0);
    expect(report.breakdown.tools).toBeGreaterThan(0);
    expect(report.breakdown.summary).toBeGreaterThan(0);
    expect(report.breakdown.cleared).toBeGreaterThan(0);
    expect(report.breakdown.toolResults).toBeGreaterThan(0);
    expect(report.counts).toEqual({ messages: 6, toolResults: 3, cleared: 1, spilled: 1 });
    expect(report.summarized).toBe(true);
    expect(report.clearAt).toBe(Math.floor(report.ceiling / 2));
  });
});

describe('manageContextModel reporting', () => {
  function model() {
    return new MockLanguageModelV4({ doGenerate: async () => ({
      content: [{ type: 'text', text: 'Done' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 120, noCache: 20, cacheRead: 100, cacheWrite: 0 },
        outputTokens: { total: 3, text: 3, reasoning: 0 },
      },
      warnings: [],
    }) });
  }

  function options() {
    const root = mkdtempSync(join(tmpdir(), 'cberg-report-'));
    roots.push(root);

    return { profile, context: ContextStore.open(root), summarize: vi.fn(async () => 'summary') };
  }

  it('reports each main-agent request with its chat and provider usage', async () => {
    const events: ContextEvent[] = [];
    unsubscribe.push(onContextEvent((event) => events.push(event)));

    const managed = manageContextModel(model(), { ...options(), describeSystem: () => ({ stable: 'SYS', context: '' }) });
    await chatScope.run('/sessions/chat-1', () => new ToolLoopAgent({ model: managed, instructions: 'SYS' }).generate({ prompt: 'Hello' }));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'request', chat: '/sessions/chat-1' });
    expect(events[0]?.type === 'request' && events[0].report.usage).toEqual({ input: 120, cacheRead: 100, cacheWrite: 0, output: 3 });
  });

  it('still answers when building a report fails', async () => {
    unsubscribe.push(onContextEvent(() => undefined));

    const describeSystem = () => {
      throw new Error('broken report');
    };
    const managed = manageContextModel(model(), { ...options(), describeSystem });
    const result = await new ToolLoopAgent({ model: managed }).generate({ prompt: 'Hello' });

    expect(result.text).toBe('Done');
  });

  it('skips the report when nothing listens', async () => {
    const describeSystem = vi.fn(() => ({ stable: 'SYS', context: '' }));

    await new ToolLoopAgent({ model: manageContextModel(model(), { ...options(), describeSystem }) }).generate({ prompt: 'Hello' });

    expect(describeSystem).not.toHaveBeenCalled();
  });

  it('stays quiet for models that do not describe a system prompt', async () => {
    const events: ContextEvent[] = [];
    unsubscribe.push(onContextEvent((event) => events.push(event)));

    await new ToolLoopAgent({ model: manageContextModel(model(), options()) }).generate({ prompt: 'Hello' });

    expect(events).toEqual([]);
  });
});
