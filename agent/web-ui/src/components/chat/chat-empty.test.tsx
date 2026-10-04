import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChatEmptyState } from './chat-empty';

describe('chat empty state', () => {
  it('offers starting questions without the removed introductory copy', () => {
    const html = renderToStaticMarkup(<ChatEmptyState onChoose={() => undefined} />);
    expect(html).toContain('Ask about the codebase');
    expect(html).toContain('Where is the main entry point?');
    expect(html).toContain('How is authentication handled?');
    expect(html).not.toContain('Semantic code search with citations.');
    expect(html).not.toContain('Choose a question and edit it before sending.');
    expect(html.match(/type="button"/g)).toHaveLength(3);
  });
});
