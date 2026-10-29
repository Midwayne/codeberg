import { expect, it, vi } from 'vitest';
import { toolJournal } from '../runs/tools.js';
import { requestDecision } from './client.js';
import { decisionTools } from './tool.js';
import type { DecisionModel, DecisionRequest } from './types.js';

const model: DecisionModel = {
  key: 'openai:decisions', provider: 'openai', model: 'gpt-6-luna', label: 'Decisions',
  api: 'openai', endpoint: 'https://example.test/decisions', apiKeyEnv: 'TEST_KEY',
};
const input: DecisionRequest = { state: 'Shared source evidence.\n'.repeat(600),
  questions: [{ name: 'relevant', type: 'predicate', instructions: 'Is this evidence relevant?' }] };

it('reduces provider submissions for identical decisions within one run (five trials)', async () => {
  const trials: { baseline: number; optimized: number; baselineChars: number; optimizedChars: number }[] = [];
  for (let trial = 0; trial < 5; trial++) {
    const bodies: string[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body));

      return Response.json({ answers: [{ name: 'relevant', type: 'predicate', probability: 0.8 }],
        usage: { input_tokens: 3000, output_tokens: 0 } });
    });
    const deps = { env: { TEST_KEY: 'test' }, fetch };
    for (let i = 0; i < 5; i++) await requestDecision(model, input, deps);

    const baseline = fetch.mock.calls.length;
    const baselineChars = bodies.reduce((sum, body) => sum + body.length, 0);
    fetch.mockClear();
    bodies.length = 0;
    const execute = decisionTools(model, deps).decide!.execute!;
    await toolJournal.run({ append: async () => undefined, pending: new Set() }, async () => {
      for (let i = 0; i < 5; i++) await execute(input, { toolCallId: `trial-${trial}-${i}`, messages: [], context: {} });
    });

    trials.push({ baseline, optimized: fetch.mock.calls.length, baselineChars,
      optimizedChars: bodies.reduce((sum, body) => sum + body.length, 0) });
  }

  if (process.env.CODEBERG_DECISIONS_BENCH) console.info(JSON.stringify({ trials }));
  expect(trials.map((trial) => trial.optimized)).toEqual([1, 1, 1, 1, 1]);
  expect(trials.every((trial) => trial.optimizedChars * 5 === trial.baselineChars)).toBe(true);
});
