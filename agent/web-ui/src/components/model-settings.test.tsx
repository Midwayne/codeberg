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
    expect(html).toContain('id="decisions-model"');
    expect(html).toContain('>Off</option>');
    expect(html).toContain('Add decision_models in models.yml');
    expect(html).toContain('Context window: 50,000 tokens');
    expect(html).toContain('Context window: 90,000 tokens');
    expect(html).toContain('<option value="openai:beta">openai · Beta (beta)</option>');
  });

  it('defaults summaries to the chat model and shows an effort once a model is chosen', () => {
    const models: CatalogModel[] = [
      { key: 'openai:alpha', model: 'openai:alpha', provider: 'openai', label: 'Alpha', contextWindow: 50000, efforts: ['low', 'high'], inputs: ['text'] },
    ];
    const choice = { key: 'openai:alpha', effort: 'high' as const };
    const render = (summary?: typeof choice | null) => renderToStaticMarkup(<ModelSettingsForm
      models={models}
      value={{ chat: choice, learning: choice, summary }}
      onChange={() => undefined}
    />);

    const unset = render(null);

    expect(unset).toContain('<option value="" selected="">Same as chat model</option>');
    expect(unset).not.toContain('id="summary-effort"');

    const chosen = render(choice);

    expect(chosen).toContain('id="summary-model"');
    expect(chosen).toContain('id="summary-effort"');
  });

  it('shows separate decisions choices without offering them for chat or learning', () => {
    const html = renderToStaticMarkup(<ModelSettingsForm
      models={[{ key: 'openai:chat', model: 'openai:chat', provider: 'openai', label: 'Chat', contextWindow: 32000, efforts: ['none'], inputs: ['text'] }]}
      decisionModels={[{ key: 'typesafe:fast', provider: 'typesafe', model: 'jev-latest', label: 'Jev',
        api: 'system-one', endpoint: 'https://api.typesafe.ai/v1/systemone', apiKeyEnv: 'TYPESAFE_API_KEY' }]}
      value={{ chat: { key: 'openai:chat', effort: 'none' }, learning: { key: 'openai:chat', effort: 'none' }, decisions: 'typesafe:fast' }}
      onChange={() => undefined}
    />);

    expect(html).toContain('<option value="typesafe:fast" selected="">typesafe · Jev</option>');
    expect(html.match(/typesafe · Jev/g)).toHaveLength(1);
    expect(html).toContain('Decision calls have separate provider costs.');
    expect(html).not.toContain('Add decision_models');
  });
});
