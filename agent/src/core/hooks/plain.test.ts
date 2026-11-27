import { describe, expect, it } from 'vitest';

import { applyPromptHooksToText } from './runtime.js';

describe('/dumb prompt hook', () => {
  it('rewrites /dumb into the plain-language request with the question', () => {
    const out = applyPromptHooksToText('/dumb why are checkouts failing?');

    expect(out).toContain("Codeberg's /dumb prompt hook");
    expect(out).toContain('why are checkouts failing?');
  });

  it('matches the trigger case-insensitively and only as a whole word', () => {
    expect(applyPromptHooksToText('/DUMB status?')).toContain('status?');

    expect(applyPromptHooksToText('/dumber idea')).toBe('/dumber idea');
  });

  it('asks for the question when /dumb has no text', () => {
    const out = applyPromptHooksToText('/dumb');

    expect(out).toContain('typed /dumb without a question');
  });

});
