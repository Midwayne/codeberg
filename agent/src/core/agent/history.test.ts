import type { ModelMessage } from 'ai';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DaemonClient, DEFAULT_DAEMON_URL } from '../client.js';
import { ContextStore } from '../context/store.js';
import type { Prompt } from '../types.js';
import { AgentState } from './state.js';
import { compactHistory, summarize } from './history.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function stateWith(contextWindow = 12000) {
  const root = mkdtempSync(join(tmpdir(), 'cberg-history-'));
  roots.push(root);

  const generate = vi.fn(async (_prompt: Prompt) => 'SUMMARY');
  const state = new AgentState({
    model: {} as never,
    daemon: new DaemonClient(DEFAULT_DAEMON_URL),
    learning: false,
    generator: { generate },
    profile: { provider: 'test', modelId: 'test', contextWindow, cache: 'none' },
    context: ContextStore.open(root),
  });

  return { state, generate };
}

describe('history preparation', () => {
  it('spills oversized results before deciding whether a summary call is needed', async () => {
    const { state, generate } = stateWith();
    const output = 'source\n'.repeat(10000);
    const messages: ModelMessage[] = [
      ...Array.from({ length: 8 }, (_, i) => ({
        role: i % 2 ? 'assistant' as const : 'user' as const,
        content: 'x'.repeat(100),
      })),
      { role: 'user', content: 'Read source' },
      { role: 'assistant', content: [
        { type: 'tool-call', toolCallId: '1', toolName: 'read_file', input: {} },
      ] },
      { role: 'tool', content: [
        { type: 'tool-result', toolCallId: '1', toolName: 'read_file',
          output: { type: 'text', value: output } },
      ] },
      { role: 'assistant', content: 'Found source' },
    ];
    const result = await compactHistory(state, messages);

    expect(generate).not.toHaveBeenCalled();
    expect(result).toHaveLength(messages.length);
    expect(messages[10]).toMatchObject({ content: [{ output: { value: output } }] });

    const index = await readFile(join(state.context.root, 'tools/INDEX.txt'), 'utf8');
    const file = index.trim().split('\t')[1]!;

    expect(await readFile(file, 'utf8')).toBe(output);
    expect(result[10]).toMatchObject({ content: [{ output: { value: expect.stringContaining(file) } }] });
  });

  it('requests a concise structured checkpoint with a bounded output', async () => {
    const { state, generate } = stateWith(2000);
    await summarize(state, 'transcript');

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'transcript',
      maxOutputTokens: 250,
      system: expect.stringContaining('Objective'),
    }));
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      system: expect.stringContaining('unresolved'),
    });
  });

  it('caps checkpoints at 2,000 output tokens even for a large window', async () => {
    const { state, generate } = stateWith(1000000);
    await summarize(state, 'transcript');

    expect(generate.mock.calls[0]?.[0].maxOutputTokens).toBe(2000);
  });
});
