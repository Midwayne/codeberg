import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ModelSettingsForm } from './model-settings';
import type { CatalogModel } from '../lib/models';

describe('ModelSettingsForm', () => {
  it('shows independent model/effort controls and both context windows', () => {
    const models: CatalogModel[] = [
      { key: 'openai:alpha', model: 'openai:alpha', provider: 'openai', label: 'Alpha', contextWindow: 50000, efforts: ['low', 'high'], inputs: ['text'] },
      { key: 'openai:beta', model: 'openai:alpha', provider: 'openai', label: 'Beta', contextWindow: 90000, efforts: ['none', 'low'], inputs: ['text'] },
    ];
    const html = renderToStaticMarkup(<ModelSettingsForm
      models={models}
      value={{ chat: { key: 'openai:alpha', effort: 'high' }, learning: { key: 'openai:beta', effort: 'none' } }}
      onChange={() => undefined}
    />);
    expect(html).toContain('id="chat-model"');
    expect(html).toContain('id="chat-effort"');
    expect(html).toContain('id="learning-model"');
    expect(html).toContain('id="learning-effort"');
    expect(html).toContain('Context window: 50,000 tokens');
    expect(html).toContain('Context window: 90,000 tokens');
    expect(html).toContain('<option value="openai:beta">openai · Beta (beta)</option>');
  });
});
