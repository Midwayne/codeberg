import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChatModelPicker, pickModel } from './chat-model-picker';
import { chatModelEntry, type CatalogModel, type ChatModels, type ModelSelection } from '../../lib/models';

const catalog: CatalogModel[] = [
  { key: 'openai:small', model: 'openai:small', provider: 'openai', label: 'Small', contextWindow: 50000, efforts: ['low', 'high'], inputs: ['text'] },
  { key: 'openai:large', model: 'openai:large', provider: 'openai', label: 'Large', contextWindow: 90000, efforts: ['high'], inputs: ['text', 'vision'] },
];
const models: ChatModels = { models: catalog, chat: { key: 'openai:small', effort: 'low' } };

function render(value: ModelSelection | null) {
  return renderToStaticMarkup(<ChatModelPicker models={models} value={value} onChange={async () => undefined} />);
}

describe('ChatModelPicker', () => {
  it('follows the default until a chat picks its own model, offering effort only when there is a choice', () => {
    const following = render(null);
    expect(following).toContain('<option value="" selected="">Default (Small · low)</option>');
    expect(following).not.toContain('Effort for this chat');

    expect(render({ key: 'openai:small', effort: 'high' })).toContain('Effort for this chat');
    expect(render({ key: 'openai:large', effort: 'high' })).not.toContain('Effort for this chat');
  });

  it('shows a chat whose model or effort left the catalog as following the default', () => {
    expect(render({ key: 'openai:removed', effort: 'high' })).toContain('<option value="" selected="">');
    expect(render({ key: 'openai:large', effort: 'low' })).toContain('<option value="" selected="">');
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
});
