import { describe, expect, it } from 'vitest';

import { parseSearchArgs, SearchCliError } from './search.js';

describe('parseSearchArgs', () => {
  it('returns help for --help', () => {
    expect(parseSearchArgs(['node', 'search', '--help'])).toBe('help');
  });

  it('parses query and flags', () => {
    const opts = parseSearchArgs([
      'node',
      'search',
      'chunking',
      '--k',
      '5',
      '--repo',
      'main',
      '--hybrid',
    ]);
    expect(opts).not.toBe('help');
    if (opts === 'help') return;
    expect(opts.query).toBe('chunking');
    expect(opts.k).toBe(5);
    expect(opts.repo).toBe('main');
    expect(opts.hybrid).toBe(true);
  });

  it('rejects unknown flags', () => {
    expect(() => parseSearchArgs(['node', 'search', '--nope', 'x'])).toThrow(SearchCliError);
  });

  it('rejects missing flag values', () => {
    expect(() => parseSearchArgs(['node', 'search', 'q', '--k'])).toThrow(/requires a value/);
  });

  it('rejects invalid k', () => {
    expect(() => parseSearchArgs(['node', 'search', 'q', '--k', '0'])).toThrow(/positive integer/);
  });

  it('rejects invalid min-score', () => {
    expect(() => parseSearchArgs(['node', 'search', 'q', '--min-score', '2'])).toThrow(
      /between 0 and 1/,
    );
  });
});
