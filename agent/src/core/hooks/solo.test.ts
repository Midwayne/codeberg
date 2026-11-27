import { describe, expect, it } from 'vitest';

import { promptCommandCatalog } from './catalog.js';
import { applyPromptHooksToText } from './runtime.js';

describe('/solo prompt hook', () => {
  it('rewrites /solo into the main-agent request with the user text', () => {
    const out = applyPromptHooksToText('/solo where is chunking implemented?');

    expect(out).toContain("Codeberg's /solo prompt hook");
    expect(out).toContain('where is chunking implemented?');
  });

  it('matches the trigger case-insensitively and only as a whole word', () => {
    expect(applyPromptHooksToText('/SOLO explain search')).toContain('explain search');

    expect(applyPromptHooksToText('/solosis idea')).toBe('/solosis idea');
  });

  it('asks for the request when /solo has no text', () => {
    const out = applyPromptHooksToText('/solo');

    expect(out).toContain('typed /solo without a request');
  });

  it('is listed in the command catalog after /dumb', () => {
    const triggers = promptCommandCatalog().map((command) => command.trigger);

    expect(triggers).toEqual(['/enhance', '/dumb', '/solo']);
  });
});
