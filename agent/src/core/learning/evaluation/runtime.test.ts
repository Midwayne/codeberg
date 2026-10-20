import { MockLanguageModelV4 } from 'ai/test';
import { expect, it, vi } from 'vitest';
import type { EvaluationConfiguration } from './automatic-types.js';
import { createAutomaticEvaluationRuntime } from './runtime.js';

const configuration: EvaluationConfiguration = {
  candidate: { key: 'chat', model: 'mock:candidate', effort: 'none', contextWindow: 32_000 },
  judge: { key: 'learning', model: 'mock:judge', effort: 'none', contextWindow: 32_000 },
};

function model(text = 'The count is 3.') {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

it('retrieves bounded source context, redacts secrets, and uses the pinned candidate and judge models', async () => {
  const candidate = model();
  const judge = model('{"choice":"all","rationale":"Supported."}');
  const search = vi.fn(async () =>
    Array.from({ length: 12 }, (_, index) => ({
      id: index,
      path: 'src/count.ts',
      symbol: 'count',
      start_line: 1,
      end_line: 5,
      score: 1,
      snippet: `token=private-value\n${'count returns 3. '.repeat(500)}`,
    })),
  );
  const resolveModel = vi.fn((selection) => (selection.key === 'chat' ? candidate : judge));
  const runtime = createAutomaticEvaluationRuntime({
    configuration: async () => configuration,
    search,
    resolveModel,
  });
  const result = await runtime.candidate('What does count return?', configuration);

  expect(search).toHaveBeenCalledWith(
    'What does count return?',
    { k: 10 },
    expect.any(AbortSignal),
  );
  expect(result.hits).toHaveLength(10);
  expect(result.context?.join('').length).toBeLessThanOrEqual(24_000);
  const prompt = candidate.doGenerateCalls[0].prompt;
  expect(JSON.stringify(prompt)).not.toContain('private-value');
  expect(JSON.stringify(prompt)).toContain('What does count return?');
  expect(candidate.doGenerateCalls[0].maxOutputTokens).toBe(2_048);
  await runtime.judge(configuration).generate({ system: 'grade', prompt: 'output' });

  expect(resolveModel.mock.calls.map(([selection]) => selection.model)).toEqual([
    'mock:candidate',
    'mock:judge',
  ]);
});

it('fails oversized judge inputs explicitly without truncating evidence or calling a provider', async () => {
  const resolveModel = vi.fn(() => model());
  const runtime = createAutomaticEvaluationRuntime({
    configuration: async () => configuration,
    search: async () => [],
    resolveModel,
  });

  await expect(
    runtime.judge(configuration).generate({ system: 'grade', prompt: 'x'.repeat(40_001) }),
  ).rejects.toThrow('PERMANENT_ERROR');
  expect(resolveModel).not.toHaveBeenCalled();
});
