import { renderToStaticMarkup } from 'react-dom/server';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { useProjectShell } from './use-project-shell';

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

it.each([
  { value: { ready: false, chunks: 2600, progress: { repo: 'example', phase: 'embedding', completed: 1500, total: 2600 } } },
  { value: { ready: true, indexing: true, chunks: 2600, progress: { repo: 'example', phase: 'embedding', completed: 1500, total: 2600 } } },
])('allows chat while its index is building: %j', (status) => {
  const project = { id: 'example', name: 'Example', roots: [] };
  const values = [{ defaultId: project.id, projects: [project] }, project.id, '', 0, false,
    { id: project.id, ...status }];
  vi.mocked(useState).mockImplementation((initial?: unknown) => [values.length ? values.shift() : initial, vi.fn()] as never);
  let ready = false;

  function Probe() {
    const shell = useProjectShell({ children: () => null });
    ready = shell.ready;

    return <>{shell.notice}</>;
  }

  const html = renderToStaticMarkup(<Probe />);

  expect(ready).toBe(true);
  expect(html).toContain('1,500 / 2,600 chunks');
  expect(html).toContain('progressbar');
  expect(html).toContain('Minimize indexing progress');
  expect(html).toContain('aria-valuenow="1500"');
});
