import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DEFAULT_LEARNING_SETTINGS } from '@agent/core/learning/preferences';
import { LearningSettingsView } from './learning-settings';

it('explains token impact and exposes independently named controls', () => {
  const html = renderToStaticMarkup(<LearningSettingsView settings={DEFAULT_LEARNING_SETTINGS} busy={false} onChange={() => undefined} />);
  for (const label of ['Enable learning', 'Codebase knowledge', 'Learning history', 'Dataset capture', 'Training review', 'Evaluations', 'Learn from solved answers', 'Record chats and feedback', 'Use knowledge in chats', 'Automatic source refresh', 'Services', 'Flows', 'Concepts', 'Debugging']) expect(html).toContain(label);
  expect(html).toContain('Background model calls');
  expect(html).toContain('No model calls');
  expect(html).toContain('role="switch"');
});
it('keeps component preferences checked but locks them when learning is paused', () => {
  const html = renderToStaticMarkup(<LearningSettingsView settings={{ ...DEFAULT_LEARNING_SETTINGS, enabled: false }} busy={false} onChange={() => undefined} />);
  expect(html).toContain('Learning is paused');
  expect(html).toMatch(/disabled=""[^>]*aria-label="Codebase knowledge"[^>]*aria-checked="true"/);
  expect(html).toContain('Existing data is kept');
});
