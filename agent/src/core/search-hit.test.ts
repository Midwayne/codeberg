import { describe, expect, it } from 'vitest';

import { normalizeSearchHit, parseLineRange } from './search-hit.js';

describe('parseLineRange', () => {
  it('parses compact lines string', () => {
    expect(parseLineRange('10-20')).toEqual({ start_line: 10, end_line: 20 });
  });

  it('falls back to numeric fields', () => {
    expect(parseLineRange(undefined, 3, 7)).toEqual({ start_line: 3, end_line: 7 });
  });
});

describe('normalizeSearchHit', () => {
  it('handles search_code compact output', () => {
    const hit = normalizeSearchHit({
      id: 4,
      repo: 'main',
      path: 'a.go',
      symbol: 'Foo',
      lines: '12-18',
      score: 0.88,
      snippet: 'func Foo()',
    });
    expect(hit?.start_line).toBe(12);
    expect(hit?.end_line).toBe(18);
  });
});
