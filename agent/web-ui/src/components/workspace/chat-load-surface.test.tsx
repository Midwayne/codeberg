import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { ChatLoadSurface } from './chat-load-surface';

const actions = { onRetry: () => {}, onCancel: () => {} };

it('immediately identifies the selected chat and announces its first load without a composer', () => {
  const html = renderToStaticMarkup(<ChatLoadSurface {...actions}
    title="Investigate authentication" load={{ id: 'first', status: 'loading' }} />);

  expect(html).toContain('Investigate authentication');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('role="status"');
  expect(html).toContain('Loading chat…');
  expect(html).toContain('Cancel');
  expect(html).not.toContain('<textarea');
  expect(html).not.toContain('Retry');
});

it('replaces loading feedback with an actionable error and a way back', () => {
  const html = renderToStaticMarkup(<ChatLoadSurface {...actions}
    title="Investigate authentication" load={{ id: 'first', status: 'error', message: 'Could not load chat (500). Try again.' }} />);

  expect(html).toContain('aria-busy="false"');
  expect(html).toContain('role="alert"');
  expect(html).toContain('Could not load chat (500). Try again.');
  expect(html).toContain('Retry');
  expect(html).toContain('Back to previous chat');
  expect(html).not.toContain('Loading chat…');
});
