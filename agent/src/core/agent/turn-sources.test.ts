import { describe, expect, it } from 'vitest';

import type { SearchResult } from '../types.js';
import { recordSearchHits, withSearchHits } from './turn-sources.js';

function hit(path: string): SearchResult {
  return { id: 1, repo: 'repo', path, symbol: 'sym', start_line: 1, end_line: 2, score: 1, snippet: path };
}

describe('withSearchHits', () => {
  it('keeps hits on the turn that is collecting and drops them otherwise', async () => {
    const first = withSearchHits(async () => {
      recordSearchHits([hit('a.ts')]);
      await Promise.resolve();
      recordSearchHits([hit('b.ts')]);

      return 'first';
    });
    const second = withSearchHits(async () => {
      recordSearchHits([hit('c.ts')]);

      return 'second';
    });

    recordSearchHits([hit('leaked.ts')]);

    const [left, right] = await Promise.all([first, second]);

    expect(left).toEqual({ value: 'first', sources: [hit('a.ts'), hit('b.ts')] });
    expect(right).toEqual({ value: 'second', sources: [hit('c.ts')] });
  });
});
