import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { ProjectNotice } from './project-controls';

it('shows counting until a real total is available, without a loader or invented percentage', () => {
  const html = renderToStaticMarkup(<ProjectNotice
    project={{ id: 'example', name: 'Example', roots: [] }}
    currentStatus={{ id: 'example', value: { ready: false, chunks: 0 } }}
    api={fetch} setRetry={() => undefined} setStatus={() => undefined}
  />);

  expect(html).toContain('Counting chunks');
  expect(html).not.toContain('progressbar');
});

it('keeps an index failure nonblocking and provides recovery', () => {
  const html = renderToStaticMarkup(<ProjectNotice
    project={{ id: 'example', name: 'Example', roots: [] }}
    currentStatus={{ id: 'example', error: 'Indexer unavailable' }}
    api={fetch} setRetry={() => undefined} setStatus={() => undefined}
  />);

  expect(html).toContain('fixed');
  expect(html).toContain('left-3');
  expect(html).toContain('Indexer unavailable');
  expect(html).toContain('Retry');
  expect(html).toContain('Chat and file tools remain available');
});
