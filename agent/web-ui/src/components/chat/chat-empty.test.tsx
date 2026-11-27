import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChatEmptyState } from './chat-empty';

describe('chat empty state', () => {
  it('shows only a greeting with no options to choose', () => {
    const html = renderToStaticMarkup(<ChatEmptyState />);

    expect(html).toContain('<h1');
    expect(html).not.toContain('<button');
  });
});
