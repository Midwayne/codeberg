import { describe, expect, it } from 'vitest';

import { extractEvidence } from './evidence-extract.js';

describe('extractEvidence', () => {
  it('extracts hybrid_search hits', () => {
    const hits = extractEvidence('hybrid_search', [
      {
        hit: {
          id: 1,
          repo: 'main',
          path: 'a.go',
          symbol: 'Foo',
          start_line: 10,
          end_line: 20,
          score: 0.9,
          snippet: 'func Foo()',
        },
        grep_boost: 2,
        final_score: 1.0,
      },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('a.go');
  });

  it('extracts grep matches as line references', () => {
    const hits = extractEvidence('grep', [
      { repo: 'main', path: 'b.go', line: 42, text: 'TODO: fix' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe(0);
    expect(hits[0]?.start_line).toBe(42);
    expect(hits[0]?.snippet).toBe('TODO: fix');
  });

  it('extracts get_chunk detail', () => {
    const hits = extractEvidence('get_chunk', {
      id: 7,
      repo: 'main',
      path: 'c.go',
      symbol: 'Bar',
      start_line: 1,
      end_line: 5,
      body: 'package main',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe(7);
  });

  it('returns empty for unknown tools', () => {
    expect(extractEvidence('read_file', { content: 'x' })).toEqual([]);
  });

  it('caps bulk grep matches', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      repo: 'main',
      path: `f${i}.go`,
      line: i + 1,
      text: 'hit',
    }));
    expect(extractEvidence('grep', rows)).toHaveLength(20);
  });
});
