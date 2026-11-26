import { expect, it } from 'vitest';

import type { CatalogModel, ModelSettings } from '../../core/model-types.js';
import type { ModelSettingsStore } from '../model-selection/settings.js';
import { projectEvaluationRuntime } from './evaluations.js';

const model = (key: string, contextWindow: number): CatalogModel =>
  ({ key, model: key, provider: 'openai', label: key, contextWindow, efforts: ['none', 'high'], inputs: ['text'] }) as CatalogModel;

function runtime(choices: Partial<ModelSettings>) {
  const settings = {
    current: async () => ({
      models: [model('openai:chat', 200_000), model('openai:cheap', 32_000), model('openai:strong', 400_000)],
      chat: { key: 'openai:chat', effort: 'none' },
      learning: { key: 'openai:cheap', effort: 'none' },
      subagents: { enabled: true, model: null },
      judge: { enabled: true, model: null },
      ...choices,
    }),
  } as unknown as ModelSettingsStore;

  return projectEvaluationRuntime('http://127.0.0.1:1', settings, () => ({}) as never, (resolved) => resolved);
}

it('judges with the chat model when no judge is chosen, never the learning model', async () => {
  const configuration = await runtime({}).configuration();

  expect(configuration?.candidate.key).toBe('openai:chat');
  expect(configuration?.judge).toMatchObject({ key: 'openai:chat', contextWindow: 200_000 });
});

it('judges with the chosen judge model and effort', async () => {
  const configuration = await runtime({ judge: { enabled: true, model: { key: 'openai:strong', effort: 'high' } } }).configuration();

  expect(configuration?.judge).toMatchObject({ key: 'openai:strong', effort: 'high', contextWindow: 400_000 });
});

it('leaves the judge out of the evaluation when it is off, whatever model was chosen', async () => {
  const configuration = await runtime({ judge: { enabled: false, model: { key: 'openai:strong', effort: 'high' } } }).configuration();

  expect(configuration).toEqual({ candidate: expect.objectContaining({ key: 'openai:chat' }) });
});
