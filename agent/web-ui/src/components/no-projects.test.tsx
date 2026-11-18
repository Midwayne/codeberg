import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { NoProjects } from './no-projects';

it('greets a first run with a decorative indexing animation', () => {
  const html = renderToStaticMarkup(<NoProjects onAdd={() => undefined} />);

  expect(html).toMatch(/<svg[^>]*data-onboarding-mark[^>]*aria-hidden="true"/);
  expect(html).toContain('Add a project to get started');
});

it('reveals the welcome content in order', () => {
  const html = renderToStaticMarkup(<NoProjects onAdd={() => undefined} />);
  const steps = [...html.matchAll(/data-onboard-step="(\d)"/g)].map((match) => match[1]);

  expect(steps).toEqual(['0', '1', '2']);
  expect(html).not.toContain('Choose a repository');
});
