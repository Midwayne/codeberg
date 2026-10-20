import type { ModelMessage } from 'ai';
import { expect, it } from 'vitest';

import { IncompleteSummaryError } from './context-errors.js';
import { boundTranscript, fitHistory } from './history.js';

it('never uses an incomplete checkpoint and keeps a recovery path to the archive', async () => {
  const messages: ModelMessage[] = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: 'x'.repeat(600),
  }));
  const result = await fitHistory(messages, {
    budget: 1000,
    archive: async () => '/context/history/full.txt',
    summarize: async () => { throw new IncompleteSummaryError(); },
  });

  expect(result[0]?.content).toContain('omitted');
  expect(result[0]?.content).toContain('<history_file>/context/history/full.txt</history_file>');
  expect(result[0]?.content).not.toContain('<conversation_summary>');

  await expect(fitHistory(messages, {
    budget: 1000,
    archive: async () => '/context/history/full.txt',
    summarize: async () => { throw new Error('invalid API key'); },
  })).rejects.toThrow('invalid API key');
});

it('includes the omission marker inside a strict summary-input character budget', () => {
  const bounded = boundTranscript(`opening${'x'.repeat(10000)}ending`, 128);

  expect(bounded.length).toBeLessThanOrEqual(128);
  expect(bounded).toContain('opening');
  expect(bounded).toContain('ending');
  expect(boundTranscript('long input', 0)).toBe('');
});
