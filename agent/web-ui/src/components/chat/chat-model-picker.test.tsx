import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChatModelPicker, pickModel } from './chat-model-picker';
import { historyInputs } from '../../lib/prompt-files';
import { chatModelEntry, type CatalogModel, type ChatModels, type ModelSelection } from '../../lib/models';

const catalog: CatalogModel[] = [
  { key: 'openai:small', model: 'openai:small', provider: 'openai', label: 'Small', contextWindow: 50000, efforts: ['low', 'high'], inputs: ['text'] },
  { key: 'openai:large', model: 'openai:large', provider: 'openai', label: 'Large', contextWindow: 90000, efforts: ['high'], inputs: ['text', 'vision'] },
];
const models: ChatModels = { models: catalog, chat: { key: 'openai:small', effort: 'low' } };

function render(value: ModelSelection | null, required: CatalogModel['inputs'] = []) {
  return renderToStaticMarkup(<ChatModelPicker models={models} value={value} required={required} onChange={async () => undefined} />);
}

describe('ChatModelPicker', () => {
  it('follows the default until a chat picks its own model, offering effort only when there is a choice', () => {
    const following = render(null);
    expect(following).toContain('<option value="" selected="">Default (Small · low)</option>');
    expect(following).not.toContain('Effort for this chat');

    expect(render({ key: 'openai:small', effort: 'high' })).toContain('Effort for this chat');
    expect(render({ key: 'openai:large', effort: 'high' })).not.toContain('Effort for this chat');
  });

  it('marks a chat whose model or effort left the catalog as unavailable instead of as Default', () => {
    for (const value of [{ key: 'openai:removed', effort: 'high' }, { key: 'openai:large', effort: 'low' }] as const) {
      const html = render(value);

      expect(html).toContain(`<option value="__unavailable__" disabled="" selected="">${value.key} · unavailable, using default</option>`);
    }
  });

  it('blocks models that cannot read files already in the chat', () => {
    const html = render({ key: 'openai:large', effort: 'high' }, ['vision']);

    expect(html).toContain('<option value="" disabled="">Default (Small · low)</option>');
    expect(html).toContain('<option value="openai:small" disabled="">openai · Small · can&#x27;t read this chat&#x27;s files</option>');
    expect(html).toContain('<option value="openai:large" selected="">openai · Large</option>');
  });

  it('keeps a shared effort when switching and clears the choice for Default', () => {
    expect(pickModel('openai:small', null, { ...models, chat: { key: 'openai:large', effort: 'high' } }))
      .toEqual({ key: 'openai:small', effort: 'high' });
    expect(pickModel('openai:large', { key: 'openai:small', effort: 'low' }, models)).toEqual({ key: 'openai:large', effort: 'high' });
    expect(pickModel('', { key: 'openai:large', effort: 'high' }, models)).toBeNull();
  });

  it('gives the composer the inputs of the model the chat runs on', () => {
    expect(chatModelEntry(models, { key: 'openai:large', effort: 'high' })?.inputs).toEqual(['text', 'vision']);
    expect(chatModelEntry(models, { key: 'openai:large', effort: 'low' })?.key).toBe('openai:small');
    expect(chatModelEntry(models, null)?.key).toBe('openai:small');
  });

  it('finds the inputs earlier files in the chat need', () => {
    expect(historyInputs([
      { id: 'u1', role: 'user', parts: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,' }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'and now?' }, { type: 'file', mediaType: 'text/plain', url: 'x' }] },
    ])).toEqual(['vision']);
  });
});
