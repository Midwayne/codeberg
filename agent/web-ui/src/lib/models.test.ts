import { describe, expect, it } from 'vitest';

import { selectModel, type CatalogModel } from './models';

describe('model selector', () => {
  const models: CatalogModel[] = [
    { key: 'openai:alpha', model: 'openai:alpha', provider: 'openai', label: 'Alpha', contextWindow: 50000, efforts: ['low', 'high'] },
    { key: 'openai:beta', model: 'openai:alpha', provider: 'openai', label: 'Beta', contextWindow: 90000, efforts: ['none', 'low'] },
  ];

  it('preserves an allowed effort or selects the first supported effort for another model', () => {
    const chat = { key: 'openai:alpha', effort: 'high' as const };
    expect(selectModel(chat, 'openai:beta', models)).toEqual({ key: 'openai:beta', effort: 'none' });
    expect(selectModel({ ...chat, effort: 'low' }, 'openai:beta', models)).toEqual({ key: 'openai:beta', effort: 'low' });
  });
});
