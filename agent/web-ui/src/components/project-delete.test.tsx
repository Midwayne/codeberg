import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ProjectDeleteOptions } from './project-delete-options';

it('defaults to retaining history and explains knowledge reuse and source safety', () => {
  const html = renderToStaticMarkup(<ProjectDeleteOptions mode="index" onChange={() => undefined} disabled={false} />);

  expect(html).toContain('Delete indexed files only');
  expect(html).toContain('Delete entire history, including knowledge');
  expect(html).toContain('reused');
  expect(html).toContain('source files');
  expect(html).toMatch(/checked=""[^>]*value="index"/);
  expect(html).not.toMatch(/checked=""[^>]*value="all"/);
});
