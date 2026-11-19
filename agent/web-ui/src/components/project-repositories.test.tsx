import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';

import { rescanRepositories, previewRepositories } from '../lib/repository-requests';
import type { Project } from '../lib/project-api';
import { AddProjectRepositories } from './project-add-repositories';
import { ProjectRepositories } from './project-repositories';

const team: Project = {
  id: 'p-1',
  name: 'Team A',
  directory: '/work/team-a',
  discover: true,
  ignored: ['tools/legacy'],
  roots: [
    { key: 'team-a', root: '/work/team-a' },
    { key: 'api', root: '/work/team-a/api' },
    { key: 'storage', root: '/work/team-a/storage' },
  ],
};

afterEach(() => vi.unstubAllGlobals());

function checkboxes(html: string) {
  return [
    ...html.matchAll(/<input type="checkbox"[^>]*>[\s\S]*?break-all font-medium">([^<]+)</g),
  ].map((match) => `${match[1]}:${match[0].includes('checked') ? 'on' : 'off'}`);
}

it('previews the repositories a new project will index separately', () => {
  const preview = {
    directory: '/work/team-a',
    repositories: [
      { key: 'api', root: '/work/team-a/api', path: 'api', marker: '.git' },
      { key: 'web', root: '/work/team-a/web', path: 'web', marker: 'package.json' },
    ],
  };

  const html = renderToStaticMarkup(
    <AddProjectRepositories
      preview={preview}
      ignored={['web']}
      busy={false}
      onToggle={() => undefined}
      onSetIgnored={() => undefined}
    />,
  );

  expect(html).toContain('2 repositories found');
  expect(html).toContain('1 of 2 indexed separately');
  expect(html).toMatch(/<details(?![^>]*open)[^>]*>/);
  expect(html).toContain('Git repository');
  expect(html).toContain('Has package.json');
  expect(checkboxes(html)).toEqual(['api:on', 'web:off']);
});

it('says when a directory is indexed as one', () => {
  const html = renderToStaticMarkup(
    <AddProjectRepositories
      preview={{ directory: '/r', repositories: [] }}
      ignored={[]}
      busy={false}
      onToggle={() => undefined}
      onSetIgnored={() => undefined}
    />,
  );

  expect(html).toContain('No separate repositories inside');
});

it('lists repositories and folders kept in the project directory', () => {
  const html = renderToStaticMarkup(
    <ProjectRepositories project={team} onUpdated={() => undefined} />,
  );

  expect(checkboxes(html)).toEqual(['api:on', 'storage:on', 'tools/legacy:off']);
  expect(html).toContain('Repository key: api');
  expect(html).toContain('Rescan repositories');
  expect(html).not.toContain('Save repositories');
});

it('offers to split a project added before repositories were found', () => {
  const legacy: Project = { id: 'p-2', name: 'Old', roots: [{ key: 'old', root: '/work/old' }] };

  const html = renderToStaticMarkup(
    <ProjectRepositories project={legacy} onUpdated={() => undefined} />,
  );

  expect(html).toContain('Find repositories');
  expect(html).not.toContain('type="checkbox"');
});

it('leaves fixed multi-root workspaces alone', () => {
  const fixed: Project = {
    id: 'p-3',
    name: 'Existing workspace',
    roots: [
      { key: 'a', root: '/a' },
      { key: 'b', root: '/b' },
    ],
  };

  expect(
    renderToStaticMarkup(<ProjectRepositories project={fixed} onUpdated={() => undefined} />),
  ).toBe('');
});

it('sends preview and rescan requests to the project service', async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ directory: '/work/team-a', repositories: [] }),
  );
  vi.stubGlobal('fetch', fetch);

  await previewRepositories('/work/team-a');
  await rescanRepositories('p-1', ['web']);

  expect(fetch.mock.calls[0]![0]).toBe('/api/projects/discover?root=%2Fwork%2Fteam-a');
  expect(fetch.mock.calls[1]![0]).toBe('/api/projects/p-1/rescan');
  expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toEqual({ ignored: ['web'] });
});

function manyRepositories(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    key: `svc-${index}`,
    root: `/work/team-a/svc-${index}`,
    path: `svc-${index}`,
    marker: '.git',
  }));
}

it('summarises a large directory so nothing needs reviewing by default', () => {
  const preview = { directory: '/work/team-a', repositories: manyRepositories(50) };

  const html = renderToStaticMarkup(
    <AddProjectRepositories
      preview={preview}
      ignored={[]}
      busy={false}
      onToggle={() => undefined}
      onSetIgnored={() => undefined}
    />,
  );

  expect(html).toContain('50 repositories found');
  expect(html).toContain('all indexed separately');
  expect(html).toContain('Review');
});

it('offers a filter and bulk choices for long lists', () => {
  const preview = { directory: '/work/team-a', repositories: manyRepositories(12) };

  const html = renderToStaticMarkup(
    <AddProjectRepositories
      preview={preview}
      ignored={[]}
      busy={false}
      onToggle={() => undefined}
      onSetIgnored={() => undefined}
    />,
  );

  expect(html).toContain('aria-label="Filter repositories"');
  expect(html).toContain('Check all');
  expect(html).toContain('Uncheck all');
});

it('keeps short lists free of bulk controls', () => {
  const html = renderToStaticMarkup(
    <ProjectRepositories project={team} onUpdated={() => undefined} />,
  );

  expect(html).not.toContain('Filter repositories');
});
