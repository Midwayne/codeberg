import { describe, expect, it } from 'vitest';

import { titleFromText } from './title.js';

describe('titleFromText', () => {
  it('returns the empty fallback for blank input', () => {
    expect(titleFromText('')).toBe('New chat');
    expect(titleFromText('   \n\t  ', '(untitled)')).toBe('(untitled)');
  });

  it('collapses whitespace', () => {
    expect(titleFromText('  why does\n  login   fail? ')).toBe('why does login fail?');
  });

  it('truncates long titles with an ellipsis', () => {
    const long = 'a'.repeat(80);
    const title = titleFromText(long);
    expect(title.length).toBe(60);
    expect(title.endsWith('…')).toBe(true);
    expect(title.slice(0, 59)).toBe('a'.repeat(59));
  });
});
