import { describe, expect, it } from 'vitest';

import { isSpillPreview, spilledToolTitle } from './tool-output';

describe('spilledToolTitle', () => {
  it('does not report a spilled result as zero', () => {
    const oldPreview = '[spilled to /tmp/grep.txt — 33000 chars; the middle is only in that file]';
    expect(isSpillPreview(oldPreview)).toBe(true);
    expect(spilledToolTitle('grep', oldPreview)).toBe('Large grep matches (spilled)');
  });

  it('uses the preserved result count when available', () => {
    const preview =
      '[spilled to /tmp/tree.txt — 27000 chars; result_count=173; the middle is only in that file]';
    expect(spilledToolTitle('tree', preview)).toBe('173 tree results (spilled)');
  });
});
