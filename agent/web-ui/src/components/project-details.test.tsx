import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import type { Project } from '../lib/project-api';
import { ProjectDetails } from './project-details';

const team: Project = {
  id: 'p-1',
  name: 'Team A',
  directory: '/work/team-a',
  roots: [
    { key: 'team-a', root: '/work/team-a' },
    { key: 'api', root: '/work/team-a/api' },
    { key: 'storage', root: '/work/team-a/storage' },
  ],
};

function labels(html: string) {
  return [...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1]);
}

it('lists the project directory and the repositories found in it, with nothing to configure', () => {
  const html = renderToStaticMarkup(<ProjectDetails project={team} onRenamed={() => undefined} />);

  expect(labels(html).slice(0, 3)).toEqual(['Project directory', 'Repository', 'Repository']);
  expect(html).toContain('/work/team-a/api');
  expect(html).not.toContain('type="checkbox"');
  expect(html).not.toMatch(/Rescan|Find repositories|Save repositories/);
});

it('keeps the plain label for workspaces started with fixed roots', () => {
  const fixed: Project = {
    id: 'p-2',
    name: 'Existing workspace',
    roots: [
      { key: 'a', root: '/a' },
      { key: 'b', root: '/b' },
    ],
  };

  expect(
    labels(
      renderToStaticMarkup(<ProjectDetails project={fixed} onRenamed={() => undefined} />),
    ).slice(0, 2),
  ).toEqual(['Directory', 'Directory']);
});
