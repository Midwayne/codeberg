import { expect, it } from 'vitest';
import { docsDestination, topicMotion } from './routing';

const current = 'http://localhost:48088/docs/getting-started';
const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

it('navigates documentation topics without reloading the surrounding shell', () => {
  expect(docsDestination('/docs/models', current, click)?.pathname).toBe('/docs/models');
  expect(docsDestination('/docs/models#add-a-model-catalog', current, click)?.hash).toBe('#add-a-model-catalog');
});

it('preserves native hash links, external links, new tabs, and modified clicks', () => {
  for (const href of ['#open-the-app', '/', 'https://example.com/docs/models', '/docs-other']) {
    expect(docsDestination(href, current, click)).toBeUndefined();
  }

  expect(docsDestination('/docs/models', current, { ...click, metaKey: true })).toBeUndefined();
  expect(docsDestination('/docs/models', current, { ...click, ctrlKey: true })).toBeUndefined();
  expect(docsDestination('/docs/models', current, { ...click, button: 1 })).toBeUndefined();
  expect(docsDestination('/docs/models', current, click, '_blank')).toBeUndefined();
  expect(docsDestination('/docs/models', current, click, undefined, true)).toBeUndefined();
});

it('keeps keyboard navigation immediate and gives pointer navigation a directional hint', () => {
  expect(topicMotion('/docs/getting-started', '/docs/models', 0, false)).toBe('instant');
  expect(topicMotion('/docs/getting-started', '/docs/models', 1, true)).toBe('instant');
  expect(topicMotion('/docs/getting-started', '/docs/models', 1, false)).toBe('forward');
  expect(topicMotion('/docs/models', '/docs/getting-started', 1, false)).toBe('backward');
  expect(topicMotion('/docs/models', '/docs/models', 1, false)).toBe('instant');
});
