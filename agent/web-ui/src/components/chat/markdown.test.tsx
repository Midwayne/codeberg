import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import Markdown from './markdown';

describe('markdown citations', () => {
  it('keeps adjacent citations inside the paragraph they support', () => {
    const html = renderToStaticMarkup(
      <Markdown>{'The consumer processes events. [src/consumer.ts:12-20] [src/service.ts:30-40]'}</Markdown>,
    );

    expect(html.match(/<p\b/g)).toHaveLength(1);
    expect(html).toMatch(/<p\b[^>]*>The consumer processes events\.[\s\S]*aria-label="src\/consumer.ts:12-20"[\s\S]*aria-label="src\/service.ts:30-40"[\s\S]*<\/p>/);
  });

  it('keeps citations inline in a numbered list before following prose', () => {
    const html = renderToStaticMarkup(
      <Markdown>{'1. **Trigger:** Processes events. [src/consumer.ts:12] [src/service.ts:30] Then persists.\n2. **Write:** Saves items. [src/repository.ts:42]'}</Markdown>,
    );

    expect(html.match(/<li\b/g)).toHaveLength(2);
    expect(html).toMatch(/<li\b[^>]*>[\s\S]*aria-label="src\/consumer.ts:12"[\s\S]*aria-label="src\/service.ts:30"[\s\S]*Then persists\.[\s\S]*<\/li>/);
    expect(html).not.toMatch(/<\/p>\s*<div[^>]*>\s*<span class="group\/cite/);
  });

  it.each(['\n', '  \n', '\\\n', '\n\n'])('attaches citation-only lines separated by %j to their supporting text', (separator) => {
    const html = renderToStaticMarkup(
      <Markdown>{`**Trigger:** Processes events.${separator}[src/consumer.ts:12]\n\n[src/service.ts:30]\n\n**Write:** Saves items.${separator}[src/repository.ts:42]`}</Markdown>,
    );

    expect(html.match(/<p\b/g)).toHaveLength(2);
    expect(html).toMatch(/Processes events\.[\s\S]*aria-label="src\/consumer.ts:12"[\s\S]*aria-label="src\/service.ts:30"[\s\S]*<\/p>/);
    expect(html).not.toContain('<br');
    expect(html).not.toMatch(/<\/p>[\s\S]*aria-label="src\/consumer.ts:12"/);
  });
});
