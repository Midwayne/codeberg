import { renderToStaticMarkup } from 'react-dom/server';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { useProjectShell } from './use-project-shell';
import type { ProjectStatus } from './project-api';

vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

it.each([
  undefined,
  { ready: false, indexing: true, chunks: 0 },
  { ready: true, indexing: true, chunks: 42, vectors_enabled: false,
    progress: { repo: 'example', phase: 'graph', completed: 1, total: 3 } },
])('hides routine indexing progress without embeddings: %j', (value) => {
  const html = renderNoVectorNotice(value);

  expect(html).toBe('');
});

it('keeps actionable project failures visible without embeddings', () => {
  const html = renderNoVectorNotice({ ready: false, indexing: true, chunks: 42,
    progress: { repo: 'example', phase: 'graph', completed: 1, total: 3 } },
  'Project directory is unavailable');

  expect(html).toContain('Project status unavailable');
  expect(html).toContain('Project directory is unavailable');
  expect(html).toContain('Retry');
  expect(html).not.toContain('Building graph');
  expect(html).not.toContain('indexing progress');
  expect(html).not.toContain('progressbar');
});

function renderNoVectorNotice(value?: ProjectStatus, error?: string) {
  const project = { id: 'example', name: 'Example', roots: [] };
  const values = [{ defaultId: project.id, projects: [project], vectorsEnabled: false },
    project.id, '', 0, false, value || error ? { id: project.id, value, error } : undefined];
  vi.mocked(useState).mockImplementation((initial?: unknown) => [values.length ? values.shift() : initial, vi.fn()] as never);

  function Probe() {
    const shell = useProjectShell({ children: () => null });

    return <>{shell.notice}</>;
  }

  return renderToStaticMarkup(<Probe />);
}

it.each([
  { value: { ready: false, chunks: 2600, progress: { repo: 'example', phase: 'embedding', completed: 1500, total: 2600 } } },
  { value: { ready: true, indexing: true, chunks: 2600, progress: { repo: 'example', phase: 'embedding', completed: 1500, total: 2600 } } },
  { value: { ready: true, indexing: false, chunks: 2600, progress: { repo: 'example', phase: 'embedding', completed: 1500, total: 2600 } },
    error: 'Could not check project status. Retrying automatically. Last reported progress may be out of date.' },
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
