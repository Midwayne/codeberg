import { describe, expect, it } from 'vitest';

import { isComposingKey } from './prompt-keyboard';

describe('composer keyboard handling', () => {
  it('protects composition Enter, including browsers using the legacy 229 code', () => {
    expect(isComposingKey({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(isComposingKey({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isComposingKey({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});
