import { describe, expect, it } from 'vitest';

import { selectModel, type CatalogModel } from './models';

describe('model selector', () => {
  const models: CatalogModel[] = [
    { key: 'openai:alpha', model: 'openai:alpha', provider: 'openai', label: 'Alpha', contextWindow: 50000, efforts: ['low', 'high'], inputs: ['text'] },
    { key: 'openai:beta', model: 'openai:beta', provider: 'openai', label: 'Beta', contextWindow: 90000, efforts: ['none', 'low'], inputs: ['text'] },
  ];

  it('preserves an allowed effort or selects the first supported effort for another model', () => {
    const chat = { key: 'openai:alpha', effort: 'high' as const };
    expect(selectModel(chat, 'openai:beta', models)).toEqual({ key: 'openai:beta', effort: 'none' });
    expect(selectModel({ ...chat, effort: 'low' }, 'openai:beta', models)).toEqual({ key: 'openai:beta', effort: 'low' });
  });

  it('keeps the current selection when a model declares no supported effort', () => {
    const current = { key: 'openai:alpha', effort: 'high' as const };
    expect(selectModel(current, 'openai:empty', [
      { ...models[0]!, key: 'openai:empty', efforts: [] },
    ])).toEqual(current);
  });
});
