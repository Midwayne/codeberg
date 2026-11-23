import { describe, expect, it } from 'vitest';

import { promptCommandCatalog } from './catalog.js';

describe('promptCommandCatalog', () => {
  it('exposes the built-in /enhance command by default', () => {
    const catalog = promptCommandCatalog();
    const enhance = catalog.find((c) => c.trigger === '/enhance');
    expect(enhance).toBeDefined();
    expect(enhance?.title).toBe('Enhance prompt');
    expect(enhance?.argHint).toBe('<request>');
    expect(enhance?.description.length).toBeGreaterThan(0);
  });
});
