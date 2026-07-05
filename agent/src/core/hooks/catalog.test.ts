import { describe, expect, it } from 'vitest';

import { promptCommandCatalog } from './catalog.js';
import { enhancePromptHook } from './enhance.js';
import type { PromptHook } from './types.js';

describe('promptCommandCatalog', () => {
  it('exposes the built-in /enhance command by default', () => {
    const catalog = promptCommandCatalog();
    const enhance = catalog.find((c) => c.trigger === '/enhance');
    expect(enhance).toBeDefined();
    expect(enhance?.title).toBe('Enhance prompt');
    expect(enhance?.argHint).toBe('<request>');
    expect(enhance?.description.length).toBeGreaterThan(0);
  });

  it("mirrors each hook's command metadata in order", () => {
    const a: PromptHook = {
      name: 'a',
      command: { trigger: '/a', title: 'A', summary: 'sa', description: 'da' },
      rewrite: () => undefined,
    };
    expect(promptCommandCatalog([a, enhancePromptHook])).toEqual([
      a.command,
      enhancePromptHook.command,
    ]);
  });
});
