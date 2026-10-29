import { expect, it, vi } from 'vitest';
import { reuseDecision, withDecisionScope } from './cache.js';
import { executeDecision } from './execute.js';
import type { DecisionToolInput, DecisionModel } from './types.js';
import type { DecisionResult } from './types.js';

const model: DecisionModel = { key: 'openai:fast', provider: 'openai', model: 'gpt-6-luna', label: 'Decisions',
  api: 'openai', endpoint: 'https://example.test/decisions', apiKeyEnv: 'TEST_KEY' };
const input = { state: 'Is this search result relevant?',
  questions: [{ name: 'relevant', type: 'predicate' as const, instructions: 'Does it implement caching?' }] };

function fixture() {
  const fetch = vi.fn(async () => Response.json({ answers: [{ name: 'relevant', type: 'predicate', probability: 0.8 }],
    usage: { input_tokens: 100, output_tokens: 0 } }));
  const onUsage = vi.fn().mockResolvedValue(undefined);
  const env = { TEST_KEY: 'test' };
  const deps = { fetch, onUsage, env };

  return { fetch, onUsage, env, execute: (value: DecisionToolInput = input) => executeDecision(model, value, deps) };
}

it('coalesces concurrent identical calls and records provider usage only once', async () => {
  const { execute, fetch, onUsage } = fixture();
  await withDecisionScope(async () => {
    const results = await Promise.all([execute(), execute(), execute()]);

    expect(results.map((result) => result.cached)).toEqual([false, true, true]);
    expect(results[1]?.usage).toBeUndefined();
    expect(results[0]?.usage?.input_tokens).toBe(100);
    expect(fetch).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledOnce();
  });
});

it('does not reuse results across runs, changed questions, state, or credentials', async () => {
  const { execute, fetch, env } = fixture();
  await withDecisionScope(async () => {
    await execute();
    await execute({ ...input, state: 'Different evidence' });
    await execute({ ...input, questions: [{ ...input.questions[0]!, instructions: 'Is it a test file?' }] });
    env.TEST_KEY = 'rotated';
    await execute();
  });
  await withDecisionScope(() => execute());

  expect(fetch).toHaveBeenCalledTimes(5);
});

it('does not retain provider failures or expired decisions', async () => {
  const { execute, fetch } = fixture();
  fetch.mockRejectedValueOnce(new Error('Unavailable'));
  const now = vi.spyOn(Date, 'now').mockReturnValue(0);
  try {
    await withDecisionScope(async () => {
      await expect(execute()).rejects.toThrow('Unavailable');
      expect((await execute()).cached).toBe(false);
      now.mockReturnValue(60001);
      expect((await execute()).cached).toBe(false);
    });

    expect(fetch).toHaveBeenCalledTimes(3);
  } finally {
    now.mockRestore();
  }
});

it('does not reuse judgments after a forwarded file excerpt changes', async () => {
  const { fetch } = fixture();
  const callTool = vi.fn().mockResolvedValue({ content: 'before', start_line: 1, end_line: 1, total_lines: 1 });
  const value = { ...input, files: [{ repo: 'app', path: 'cache.ts' }] };
  const execute = () => executeDecision(model, value, { fetch, env: { TEST_KEY: 'test' }, daemon: { callTool } });
  await withDecisionScope(async () => {
    expect((await execute()).cached).toBe(false);
    expect((await execute()).cached).toBe(true);
    callTool.mockResolvedValue({ content: 'after', start_line: 1, end_line: 1, total_lines: 1 });
    expect((await execute()).cached).toBe(false);
  });

  expect(callTool).toHaveBeenCalledTimes(3);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('cancels a waiting cache consumer without cancelling the original decision', async () => {
  let finish: (value: DecisionResult) => void = () => undefined;
  const call = vi.fn(() => new Promise<DecisionResult>((resolve) => { finish = resolve; }));
  await withDecisionScope(async () => {
    const first = reuseDecision('same', call);
    const controller = new AbortController();
    const second = reuseDecision('same', call, controller.signal);
    const cancelled = expect(second).rejects.toThrow('Stopped waiting');
    controller.abort(new Error('Stopped waiting'));
    await cancelled;
    finish({ answers: [{ name: 'relevant', type: 'predicate', probability: 0.8 }] });

    expect((await first).cached).toBe(false);
    expect((await reuseDecision('same', call)).cached).toBe(true);
    expect(call).toHaveBeenCalledOnce();
  });
});
