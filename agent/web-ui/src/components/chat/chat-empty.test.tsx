import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChatEmptyState } from './chat-empty';

describe('chat empty state', () => {
  it('offers actionable starting questions and explains that they can be edited', () => {
    const html = renderToStaticMarkup(<ChatEmptyState onChoose={() => undefined} />);
    expect(html).toContain('Ask about the codebase');
    expect(html).toContain('Where is the main entry point?');
    expect(html).toContain('How is authentication handled?');
    expect(html).toContain('edit it before sending');
    expect(html.match(/type="button"/g)).toHaveLength(3);
  });
});
