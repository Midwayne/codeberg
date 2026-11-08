import { expect, it } from 'vitest';

import { canvasUrl } from './api';

it('builds every canvas query parameter in one place', () => {
  expect(canvasUrl('chat')).toBe('/canvas?chat=chat');
  expect(canvasUrl('chat', { project: 'demo', embedded: true })).toBe('/canvas?chat=chat&project=demo&embedded=1');
  expect(canvasUrl('chat', { project: 'demo', motion: 'none' })).toBe('/canvas?chat=chat&project=demo&motion=none');
});
