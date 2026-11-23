import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { LoadingSkeleton } from './loading-skeleton';

it('shapes a chat skeleton like a conversation, with prompts on the right and answers on the left', () => {
  const html = renderToStaticMarkup(<LoadingSkeleton kind="chat" />);

  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('class="ui-loading-chat"');
  expect(html.match(/class="ui-loading-bubble"/g)).toHaveLength(2);
  expect(html.match(/class="ui-loading-answer"/g)).toHaveLength(2);
});
