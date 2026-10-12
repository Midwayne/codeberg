import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { type DocPage } from './catalog';
import { searchDocs } from './search';
import { DocsNavigation } from './navigation';
import { DocsLoading } from './loading';

const pages: DocPage[] = [
  { id: 'models', title: 'Models', group: 'Setup', summary: 'Choose a provider.',
    content: 'Introduction.\n## Credentials\nSet OPENAI_API_KEY for local credentials.\n## Offline\nUse a local endpoint.' },
  { id: 'tools', title: 'Tools', group: 'Concepts', summary: 'Search with tools.',
    content: '## Configuration\nModels select available tools.\n```md\n## Example only\n```\nUse grep to search files.' },
];

it('searches body text and links directly to the matching section', () => {
  const hits = searchDocs('openai_api_key', pages);

  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({ href: '/docs/models#credentials', section: 'Credentials' });
  expect(hits[0]?.snippet).toContain('OPENAI_API_KEY');
});

it('ranks document titles ahead of incidental body matches', () => {
  const hits = searchDocs('models', pages);

  expect(hits[0]?.href).toBe('/docs/models');
  expect(hits.map((hit) => hit.href)).toEqual(['/docs/models', '/docs/tools#configuration']);
  expect(searchDocs('MODELS', pages)).toEqual(searchDocs('models', pages));
});

it('returns unique document destinations when introduction and summary both match', () => {
  const hits = searchDocs('local');

  expect(new Set(hits.map((hit) => hit.href)).size).toBe(hits.length);
});

it('matches all query terms in the same section and handles empty and missing queries', () => {
  expect(searchDocs('local credentials', pages)[0]?.href).toBe('/docs/models#credentials');
  expect(searchDocs('credentials endpoint', pages)).toEqual([]);
  expect(searchDocs('does not exist', pages)).toEqual([]);
  expect(searchDocs('  ', pages).map((hit) => hit.href)).toEqual(['/docs/models', '/docs/tools']);
});

it('ignores headings inside fenced examples while retaining searchable example text', () => {
  expect(searchDocs('grep', pages)[0]?.href).toBe('/docs/tools#configuration');
  expect(searchDocs('Example only', pages)[0]?.section).toBe('Configuration');
});

it('keeps sidebar topics visible without an inline search field', () => {
  const html = renderToStaticMarkup(<DocsNavigation />);

  expect(html).not.toContain('<input');
  expect(html).toContain('Setup');
  expect(html).toContain('Concepts');
  expect(html).toContain('Guides');
});

it('uses the shared loading surface inside a stable documentation shell', () => {
  const html = renderToStaticMarkup(<DocsLoading />);

  expect(html).toContain('ui-loading-boundary');
  expect(html).toContain('ui-loading-scaffold');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('Loading documentation');
  expect(html).toContain('Back to app');
});
