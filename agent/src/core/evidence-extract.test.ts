import { describe, expect, it } from 'vitest';

import { extractEvidence } from './evidence-extract.js';

describe('extractEvidence', () => {
  it('extracts hybrid_search hits with final_score', () => {
    const hits = extractEvidence('hybrid_search', [
      {
        hit: {
          id: 1,
          repo: 'main',
          path: 'a.go',
          symbol: 'Foo',
          start_line: 10,
          end_line: 20,
          score: 0.5,
          snippet: 'func Foo()',
        },
        grep_boost: 2,
        final_score: 0.95,
      },
    ]);
    expect(hits[0]?.score).toBe(0.95);
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

  it('extracts graph-first find_references', () => {
    const hits = extractEvidence('find_references', {
      source: 'graph',
      graph: [
        {
          src: 1,
          dst: 2,
          kind: 'calls',
          confidence: 0.9,
          line: 12,
          src_name: 'caller',
          dst_name: 'Foo',
          src_path: 'a.go',
        },
      ],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('a.go');
    expect(hits[0]?.symbol).toBe('caller');
    expect(hits[0]?.start_line).toBe(12);
  });

  it('extracts trace_path hops', () => {
    const hits = extractEvidence('trace_path', [
      {
        depth: 1,
        src: 3,
        dst: 4,
        kind: 'calls',
        confidence: 0.75,
        line: 8,
        src_name: 'run',
        dst_name: 'helper',
        src_path: 'b.go',
      },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.path).toBe('b.go');
    expect(hits[0]?.snippet).toContain('helper');
  });
});
