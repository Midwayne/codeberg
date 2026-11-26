import { describe, expect, it } from 'vitest';

import { mergeProviderOptions } from './tool-calls.js';

describe('mergeProviderOptions', () => {
  it('merges per provider without dropping earlier keys', () => {
    expect(
      mergeProviderOptions(
        { openai: { promptCacheKey: 'k' } },
        undefined,
        { openai: { parallelToolCalls: true } },
        { openai: { reasoningEffort: 'max' }, anthropic: { x: 1 } },
      ),
    ).toEqual({
      openai: { promptCacheKey: 'k', parallelToolCalls: true, reasoningEffort: 'max' },
      anthropic: { x: 1 },
    });
  });

  it('returns undefined when there is nothing to send', () => {
    expect(mergeProviderOptions(undefined, undefined)).toBeUndefined();
  });
});
