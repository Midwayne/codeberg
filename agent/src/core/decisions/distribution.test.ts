import { expect, it } from 'vitest';
import { validateAnswer } from './validation.js';
import type { DecisionQuestion } from './types.js';

const question: DecisionQuestion = { name: 'file', type: 'choice', instructions: 'Read which file next?',
  choices: [{ value: 'cache.ts' }, { value: 'routes.ts' }] };

it('normalizes provider distributions into candidate order without dropping alternatives', () => {
  const base = { type: 'choice', choice: 'cache.ts', confidence: 0.7 };
  const openai = validateAnswer(question, { ...base,
    probabilities: [{ value: 'routes.ts', probability: 0.3 }, { value: 'cache.ts', probability: 0.7 }] });
  const systemOne = validateAnswer(question, { ...base, probabilities: { 'cache.ts': 0.7, 'routes.ts': 0.3 } });

  expect(openai).toEqual(systemOne);
  expect(openai.probabilities).toEqual([{ value: 'cache.ts', probability: 0.7 }, { value: 'routes.ts', probability: 0.3 }]);
});

it('normalizes rubric distributions and retains the scale descriptions', () => {
  const score: DecisionQuestion = { name: 'priority', type: 'score', instructions: 'Rate relevance', levels: ['Unrelated', 'Relevant'] };
  const answer = validateAnswer(score, { type: 'score', score: 0.8, probabilities: { '0': 0.2, '1': 0.8 } });

  expect(answer.probabilities).toEqual([{ value: 0, label: 'Unrelated', probability: 0.2 }, { value: 1, label: 'Relevant', probability: 0.8 }]);
});

it.each([
  { 'cache.ts': 0.8 },
  { 'cache.ts': 0.8, 'invented.ts': 0.2 },
  { 'cache.ts': 0.8, 'routes.ts': 0.8 },
  { 'cache.ts': -0.1, 'routes.ts': 1.1 },
  [{ value: 'cache.ts', probability: 0.5 }, { value: 'cache.ts', probability: 0.5 }],
])('rejects malformed or incomplete distributions: %j', (probabilities) => {
  expect(() => validateAnswer(question, { type: 'choice', choice: 'cache.ts', probabilities })).toThrow(/distribution/);
});

it('does not invent distributions when providers omit them', () => {
  expect(validateAnswer(question, { type: 'choice', choice: 'cache.ts' }).probabilities).toBeUndefined();
});

it('retains a refusal as a per-question result', () => {
  expect(validateAnswer(question, { type: 'refusal' })).toEqual({ name: 'file', type: 'refusal' });
});
