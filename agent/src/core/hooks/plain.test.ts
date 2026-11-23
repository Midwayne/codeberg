import { describe, expect, it } from 'vitest';

import { promptCommandCatalog } from './catalog.js';
import { applyPromptHooksToText } from './runtime.js';

describe('/dumb prompt hook', () => {
  it('rewrites /dumb into a plain-language request for a non-technical reader', () => {
    const out = applyPromptHooksToText('/dumb why are checkouts failing?');

    expect(out).toContain("Codeberg's /dumb prompt hook");
    expect(out).toContain('why are checkouts failing?');

    expect(out).toContain('project manager');
    expect(out).toMatch(/no code/i);

    expect(out).toMatch(/database/i);
    expect(out).toContain('## What this means');
  });

  it('matches the trigger case-insensitively and only as a whole word', () => {
    expect(applyPromptHooksToText('/DUMB status?')).toContain('status?');

    expect(applyPromptHooksToText('/dumber idea')).toBe('/dumber idea');
  });

  it('asks for the question when /dumb has no text', () => {
    const out = applyPromptHooksToText('/dumb');

    expect(out).toContain('typed /dumb without a question');
  });

  it('is listed in the command catalog after /enhance', () => {
    const triggers = promptCommandCatalog().map((command) => command.trigger);

    expect(triggers).toEqual(['/enhance', '/dumb']);
  });
});
