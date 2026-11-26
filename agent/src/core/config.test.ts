import type { LanguageModel } from 'ai';
import { expect, it } from 'vitest';

import { judgeModel } from './config.js';

const model = { provider: 'anthropic', modelId: 'strong' } as unknown as LanguageModel;

it('turns judging off instead of failing the agent when the judge model cannot be resolved', () => {
  const env = { CODEBERG_JUDGE_MODEL: 'openai:gpt-5' };

  expect(judgeModel(env, () => {
    throw new Error('Set OPENAI_API_KEY');
  })).toBeNull();
  expect(judgeModel(env, () => model)).toBe(model);
  expect(judgeModel({}, () => model)).toBeUndefined();
  expect(judgeModel({ ...env, CODEBERG_JUDGE_USE: 'false' }, () => model)).toBeNull();
});
