import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AddProject } from './projects';

it('offers the native folder picker alongside manual directory entry', () => {
  const html = renderToStaticMarkup(<AddProject onClose={() => undefined} onAdded={async () => undefined} />);
  expect(html).toContain('Choose folder');
  expect(html).toContain('Directory path');
  expect(html).toMatch(/<button[^>]*aria-label="Choose folder"/);
  expect(html).toContain('aria-label="Project directory"');
  expect(html).not.toContain('Browse folders');
  expect(html).not.toContain('Filter folders');
  expect(html).not.toContain('Choose a directory on the computer running Codeberg.');
});
