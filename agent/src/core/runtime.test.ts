import { describe, expect, it } from 'vitest';

import { createAgentFromEntry } from './config.js';
import { assertAgentRuntime } from './runtime.js';

describe('agent runtime compatibility', () => {
  it('rejects an old Node even if it implements AbortSignal.any', () => {
    expect(() => assertAgentRuntime('20.11.1', () => new AbortController().signal)).toThrow(
      /requires Node\.js 22 or newer/,
    );
    expect(() => assertAgentRuntime('22.15.1', AbortSignal.any)).not.toThrow();
  });
  it('rejects a missing AbortSignal.any before handling a first message', () => {
    const original = AbortSignal.any;
    Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
    try {
      expect(() => createAgentFromEntry({
        modelSpec: 'openai:gpt-4o-mini',
        daemonUrl: 'http://127.0.0.1:48080',
        question: '',
      })).toThrow(/AbortSignal\.any.*Node\.js 22/);
    } finally {
      Object.defineProperty(AbortSignal, 'any', { configurable: true, value: original });
    }
  });
});
