import type { LanguageModelV4CallOptions, LanguageModelV4Usage } from '@ai-sdk/provider';
import { expect, it } from 'vitest';

import { estimateRequest } from './estimate.js';
import { RequestUsage } from './usage.js';

const measured: LanguageModelV4Usage = {
  inputTokens: { total: 3000, noCache: 1000, cacheRead: 1500, cacheWrite: 500 },
  outputTokens: { total: 100, text: 50, reasoning: 50 },
};

it('uses measured input including cache tokens once, then estimates only new messages', () => {
  const usage = new RequestUsage();
  const first: LanguageModelV4CallOptions = {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Question' }] }],
  };
  usage.record(first, measured);

  expect(usage.estimate(first)).toBe(3000);

  const second: LanguageModelV4CallOptions = {
    prompt: [...first.prompt, { role: 'assistant', content: [{ type: 'text', text: 'Answer' }] }],
  };
  const added = estimateRequest(second) - estimateRequest(first);

  expect(usage.estimate(second)).toBe(3000 + Math.ceil(added * 1.15));
});

it('never borrows counts from a different conversation or tool schema', () => {
  const usage = new RequestUsage();
  usage.record({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'Chat one' }] }] }, measured);
  const other: LanguageModelV4CallOptions = {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Chat two' }] }],
  };

  expect(usage.estimate(other)).toBe(estimateRequest(other));

  const changed: LanguageModelV4CallOptions = {
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Chat one' }] }],
    tools: [{ type: 'function', name: 'read', inputSchema: { type: 'object' } }],
  };

  expect(usage.estimate(changed)).toBe(estimateRequest(changed));
});
