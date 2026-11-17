import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChatEmptyState } from './chat-empty';
import { chatStarters, starterPage, STARTERS_PER_PAGE } from './chat-starters';

describe('chat empty state', () => {
  it('offers titled, editable starting prompts and a way to see more', () => {
    const html = renderToStaticMarkup(<ChatEmptyState onChoose={() => undefined} />);

    expect(html).toContain('What do you want to know?');
    expect(html).toContain('Tour the codebase');
    expect(html).toContain('Trace a request');
    expect(html).toContain('More ideas');
    expect(html).toContain('/enhance');
    expect(html.match(/type="button"/g)).toHaveLength(STARTERS_PER_PAGE + 1);
  });

  it('pages through every starter and wraps back to the first page', () => {
    const seen = [starterPage(0), starterPage(1)].flat().map((starter) => starter.title);

    expect(new Set(seen).size).toBe(chatStarters.length);
    expect(starterPage(2)).toEqual(starterPage(0));
  });
});
