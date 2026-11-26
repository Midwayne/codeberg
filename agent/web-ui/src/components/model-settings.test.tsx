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
      value={{ chat: { key: 'openai:alpha', effort: 'high' }, learning: { key: 'openai:beta', effort: 'none' }, judge: { enabled: true, model: null }, subagents: { enabled: true, model: null } }}
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
      value={{ chat: choice, learning: choice, summary, judge: { enabled: true, model: null }, subagents: { enabled: true, model: null } }}
      onChange={() => undefined}
    />);

    const unset = render(null);

    expect(unset).toContain('<option value="" selected="">Same as chat model</option>');
    expect(unset).toMatch(/id="summary-effort"[^>]*disabled=""|disabled=""[^>]*id="summary-effort"/);
    expect(unset).toContain('Pick a model above to choose its effort.');

    const chosen = render(choice);

    expect(chosen).toContain('id="summary-model"');
    expect(chosen).toContain('id="summary-effort"');
    expect(chosen).toContain('<option value="high" selected="">high</option>');
    // Only the still-unset Judge and Subagents sections keep their hints.
    expect(chosen.match(/Pick a model above/g)).toHaveLength(2);
  });

  it('marks the judge as self-grading while it is the chat model under any catalog key, unless it is off', () => {
    const models: CatalogModel[] = [
      { key: 'openai:alpha', model: 'openai:alpha', provider: 'openai', label: 'Alpha', contextWindow: 50000, efforts: ['low'], inputs: ['text'] },
      { key: 'openai:alias', model: 'openai:alpha', provider: 'openai', label: 'Alias', contextWindow: 50000, efforts: ['low'], inputs: ['text'] },
      { key: 'openai:strong', model: 'openai:strong', provider: 'openai', label: 'Strong', contextWindow: 90000, efforts: ['low'], inputs: ['text'] },
    ];
    const chat = { key: 'openai:alpha', effort: 'low' as const };
    const render = (model: typeof chat | null, enabled = true) => renderToStaticMarkup(<ModelSettingsForm
      models={models}
      value={{ chat, learning: chat, judge: { enabled, model }, subagents: { enabled: true, model: null } }}
      onChange={() => undefined}
    />);

    expect(render(null)).toContain('id="judge-model"');
    expect(render(null)).toContain('self-graded');
    expect(render({ key: 'openai:alias', effort: 'low' })).toContain('self-graded');
    expect(render({ key: 'openai:strong', effort: 'low' })).not.toContain('self-graded');
    expect(render(null, false)).not.toContain('self-graded');
    expect(render(null, false)).toMatch(/id="judge-model"[^>]*disabled=""|disabled=""[^>]*id="judge-model"/);
  });

  it('shows the subagent switch on by default, following the summary model', () => {
    const models: CatalogModel[] = [
      { key: 'openai:alpha', model: 'openai:alpha', provider: 'openai', label: 'Alpha', contextWindow: 50000, efforts: ['low', 'high'], inputs: ['text'] },
    ];
    const choice = { key: 'openai:alpha', effort: 'high' as const };
    const render = (subagents: { enabled: boolean; model: typeof choice | null } = { enabled: true, model: null }) => renderToStaticMarkup(<ModelSettingsForm
      models={models}
      value={{ chat: choice, learning: choice, judge: { enabled: true, model: null }, subagents }}
      onChange={() => undefined}
    />);

    const unset = render();

    expect(unset).toMatch(/role="switch"[^>]*checked=""/);
    expect(unset).toContain('<option value="" selected="">Same as summary model</option>');
    expect(unset).toMatch(/id="subagent-effort"[^>]*disabled=""|disabled=""[^>]*id="subagent-effort"/);

    const off = render({ enabled: false, model: choice });

    expect(off).toMatch(/id="subagent-model"[^>]*disabled=""|disabled=""[^>]*id="subagent-model"/);
    expect(off).toContain('id="subagent-effort"');
  });

  it('shows separate decisions choices without offering them for chat or learning', () => {
    const html = renderToStaticMarkup(<ModelSettingsForm
      models={[{ key: 'openai:chat', model: 'openai:chat', provider: 'openai', label: 'Chat', contextWindow: 32000, efforts: ['none'], inputs: ['text'] }]}
      decisionModels={[{ key: 'typesafe:fast', provider: 'typesafe', model: 'jev-latest', label: 'Jev',
        api: 'system-one', endpoint: 'https://api.typesafe.ai/v1/systemone', apiKeyEnv: 'TYPESAFE_API_KEY' }]}
      value={{ chat: { key: 'openai:chat', effort: 'none' }, learning: { key: 'openai:chat', effort: 'none' }, decisions: 'typesafe:fast', judge: { enabled: true, model: null }, subagents: { enabled: true, model: null } }}
      onChange={() => undefined}
    />);

    expect(html).toContain('<option value="typesafe:fast" selected="">typesafe · Jev</option>');
    expect(html.match(/typesafe · Jev/g)).toHaveLength(1);
    expect(html).toContain('Decision calls have separate provider costs.');
    expect(html).not.toContain('Add decision_models');
  });
});
