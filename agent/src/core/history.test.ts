import type { ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { estimateTokens, fitHistory, messageTokens, totalTokens } from './history.js';

function turn(role: 'user' | 'assistant', content: string): ModelMessage {
  return { role, content };
}

describe('token estimation', () => {
  it('counts ~4 chars per token across a transcript', () => {
    expect(estimateTokens('12345678')).toBe(2);
    expect(totalTokens([turn('user', '12345678'), turn('assistant', '1234')])).toBe(3);
  });

  it('counts tool results, which message text ignores', () => {
    const message: ModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: '1',
          toolName: 'grep',
          output: { type: 'text', value: 'x'.repeat(80) },
        },
      ],
    };
    expect(messageTokens(message)).toBeGreaterThan(20);
  });
});

describe('fitHistory', () => {
  it('returns the same array untouched when it already fits', async () => {
    const msgs = [turn('user', 'hi'), turn('assistant', 'there')];
    const out = await fitHistory(msgs, { budget: 1000 });
    expect(out).toBe(msgs);
  });

  it('drops the oldest behind a marker when no summarizer is given', async () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      turn(i % 2 ? 'assistant' : 'user', 'x'.repeat(40)),
    );
    const out = await fitHistory(msgs, { budget: 30, keepRecent: 3 });
    expect(out).toHaveLength(4); // marker + 3 recent
    expect(String(out[0]?.content)).toContain('omitted');
    expect(out.slice(1)).toEqual(msgs.slice(-3));
  });

  it('archives the verbatim older turns and points the summary at that file', async () => {
    const summarize = vi.fn(async () => 'SUMMARY');
    const archive = vi.fn(async (_transcript: string) => '/tmp/history/abc.txt');
    const msgs: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: '1', toolName: 'grep', input: { pattern: 'balance' } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: '1',
            toolName: 'grep',
            output: { type: 'text', value: 'ledger-worker/src/service/LedgerService.java:50' },
          },
        ],
      },
      ...Array.from({ length: 6 }, (_, i) => turn(i % 2 ? 'assistant' : 'user', 'y'.repeat(200))),
    ];
    const out = await fitHistory(msgs, {
      budget: 200,
      keepRecent: 2,
      summarize,
      archive,
    });
    expect(archive).toHaveBeenCalledOnce();
    const archived = archive.mock.calls[0]?.[0];
    expect(archived).toContain('LedgerService.java:50');
    expect(String(out[0]?.content)).toContain('SUMMARY');
    expect(String(out[0]?.content)).toContain('<history_file>/tmp/history/abc.txt</history_file>');
    expect(String(out[0]?.content)).toContain('context_grep');
  });

  it('keeps the history file path when the summary itself is trimmed', async () => {
    const summarize = vi.fn(async () => 'SUMMARY');
    const archive = vi.fn(async (text: string) => `/tmp/history/${text.length}.txt`);
    const msgs = Array.from({ length: 8 }, (_, i) => turn(i % 2 ? 'assistant' : 'user', 'y'.repeat(80)));
    const out = await fitHistory(msgs, {
      budget: 20,
      keepRecent: 2,
      summarize,
      archive,
    });
    expect(archive).toHaveBeenCalledOnce();
    const transcript = archive.mock.calls[0]?.[0] ?? '';
    expect(transcript).not.toContain('<conversation_summary>');
    expect(String(out[0]?.content)).toContain(
      `<history_file>/tmp/history/${transcript.length}.txt</history_file>`,
    );
    expect(String(out[0]?.content).match(/<history_file>/g)).toHaveLength(1);
    expect(String(out[0]?.content)).toContain('context_grep');
  });

  it('folds overflow into a single summary turn when a summarizer is given', async () => {
    const summarize = vi.fn(async () => 'SUMMARY');
    const msgs = Array.from({ length: 8 }, (_, i) =>
      turn(i % 2 ? 'assistant' : 'user', 'y'.repeat(40)),
    );
    const out = await fitHistory(msgs, {
      budget: 40,
      keepRecent: 2,
      summarize,
    });
    expect(summarize).toHaveBeenCalledOnce();
    expect(String(out[0]?.content)).toContain('SUMMARY');
    expect(out.slice(-2)).toEqual(msgs.slice(-2));
  });

  it('does not summarize when only recent turns remain over budget', async () => {
    const summarize = vi.fn(async () => 'SUMMARY');
    const msgs = [turn('user', 'z'.repeat(400))];
    const out = await fitHistory(msgs, {
      budget: 10,
      keepRecent: 6,
      summarize,
    });
    expect(summarize).not.toHaveBeenCalled();
    expect(out).toBe(msgs);
  });
});
