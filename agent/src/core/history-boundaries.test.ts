import type { ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { fitHistory, totalTokens } from './history.js';

function exchange(size: number): ModelMessage[] {
  return [
    { role: 'user', content: 'q'.repeat(size) },
    { role: 'assistant', content: 'a'.repeat(size) },
  ];
}

describe('token-budgeted recent history', () => {
  it('keeps recent whole exchanges instead of a fixed number of messages', async () => {
    const messages = Array.from({ length: 6 }, () => exchange(600)).flat();
    const result = await fitHistory(messages, { budget: 1000, summarize: async () => 'SUMMARY' });

    expect(result.slice(1)).toEqual(messages.slice(-2));
    expect(totalTokens(result)).toBeLessThan(400);
  });

  it('retains several short exchanges within the recent token allowance', async () => {
    const messages = [...exchange(8000), ...exchange(100), ...exchange(100), ...exchange(100)];
    const result = await fitHistory(messages, { budget: 1000, summarize: async () => 'SUMMARY' });

    expect(result.slice(1)).toEqual(messages.slice(2));
  });

  it('caps the retained tail at 15,000 estimated tokens on large windows', async () => {
    const messages = Array.from({ length: 30 }, () => exchange(8000)).flat();
    const result = await fitHistory(messages, { budget: 100000, summarize: async () => 'SUMMARY' });

    expect(result.slice(1)).toHaveLength(6);
    expect(totalTokens(result.slice(1))).toBe(12000);
  });

  it('never splits the newest tool exchange even when it exceeds the allowance', async () => {
    const recent: ModelMessage[] = [
      { role: 'user', content: 'Investigate chunking' },
      { role: 'assistant', content: [
        { type: 'tool-call', toolCallId: '1', toolName: 'grep', input: { pattern: 'chunk' } },
      ] },
      { role: 'tool', content: [
        { type: 'tool-result', toolCallId: '1', toolName: 'grep',
          output: { type: 'text', value: 'chunk.c\n'.repeat(100) } },
      ] },
      { role: 'assistant', content: 'Found chunk.c' },
    ];
    const result = await fitHistory([...exchange(4000), ...recent], {
      budget: 500,
      summarize: async () => 'SUMMARY',
    });

    expect(result.slice(1)).toEqual(recent);
  });

  it('expands an explicit message count to keep a whole exchange', async () => {
    const messages = [...exchange(4000), ...exchange(100)];
    const result = await fitHistory(messages, {
      budget: 500,
      keepRecent: 1,
      summarize: async () => 'SUMMARY',
    });

    expect(result.slice(1)).toEqual(messages.slice(-2));
  });

  it('leaves the latest user request intact when no older exchange can be summarized', async () => {
    const messages = exchange(8000);
    const summarize = vi.fn(async () => 'SUMMARY');
    const result = await fitHistory(messages, { budget: 500, summarize });

    expect(result).toBe(messages);
    expect(summarize).not.toHaveBeenCalled();
  });
});
