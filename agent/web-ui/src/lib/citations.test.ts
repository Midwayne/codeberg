import { describe, expect, it } from 'vitest';

import { transformCitations } from './citations';

describe('citation layout', () => {
  it('joins citation-only lines to prose while preserving the next paragraph', () => {
    expect(transformCitations('Claim.  \n\n[src/a.ts:1]\n[src/b.ts:2]\n\nNext paragraph.'))
      .toBe('Claim. <cite-chip source="src%2Fa.ts%3A1">1</cite-chip> <cite-chip source="src%2Fb.ts%3A2">2</cite-chip>\n\nNext paragraph.');
  });

  it('attaches citations after inline code and inside numbered lists', () => {
    expect(transformCitations('1. Calls `save()`.\n\n   [src/a.ts:1]\n\n2. Next step.'))
      .toBe('1. Calls `save()`. <cite-chip source="src%2Fa.ts%3A1">1</cite-chip>\n\n2. Next step.');
  });

  it('preserves fenced code, inline code, links, and ordinary line breaks', () => {
    const markdown = 'First line.\nSecond line.\n\n```text\nClaim.\n\n[src/a.ts:1]\n```\n\n`[src/a.ts:1]`\n\n[src/a.ts:1](https://example.com)';
    expect(transformCitations(markdown)).toBe(markdown);
  });

  it('does not pull citations into a preceding code block or table', () => {
    const markdown = '```text\nExample\n```\n\n[src/a.ts:1]\n\n| Name |\n| --- |\n| Value |\n\n[src/a.ts:1]';
    expect(transformCitations(markdown)).toBe(markdown.replaceAll('[src/a.ts:1]', '<cite-chip source="src%2Fa.ts%3A1">1</cite-chip>'));
  });
});
