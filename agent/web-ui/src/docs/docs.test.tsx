import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DocsLink } from '../components/docs-link';
import { ProjectShellView } from '../components/projects';
import { DocsPage } from './page';
import { DocsArticle } from './article';
import { docPages, findDocPage, documentHeadings } from './catalog';

it('offers documentation without leaving an active conversation', () => {
  const html = renderToStaticMarkup(<DocsLink />);

  expect(html).toContain('href="/docs/getting-started"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('Docs');
});

it('keeps article cross-links in the animated docs view', () => {
  const html = renderToStaticMarkup(<DocsArticle page={findDocPage('/docs/getting-started')!} />);
  const links = [...html.matchAll(/<a[^>]+href="\/docs\/[^"]+"[^>]*>/g)];

  expect(links.length).toBeGreaterThan(0);
  for (const link of links) expect(link[0]).not.toContain('target="_blank"');
});

it('keeps the docs entry visible before the first project is added', () => {
  const html = renderToStaticMarkup(<ProjectShellView
    catalog={{ defaultId: '', projects: [] }}
    project={undefined}
    api={fetch}
    ready={false}
    setCatalog={() => undefined}
    children={() => null}
    toolbar={<span />}
    notice={false}
    error=""
    setRetry={() => undefined}
    adding={false}
    setAdding={() => undefined}
    select={() => undefined}
  />);

  expect(html).toContain('Add a project to get started');
  expect(html).toContain('aria-label="Settings"');
  expect(html).toMatch(/<header[\s\S]*href="\/docs\/getting-started"[\s\S]*<\/header>/);
});

it('renders setup instructions and section navigation without a project or API', () => {
  const html = renderToStaticMarkup(<DocsPage path="/docs/models" />);

  expect(html).toContain('Documentation topics');
  expect(html).toContain('Setup');
  expect(html).toContain('Concepts');
  expect(html).toContain('Guides');
  expect(html).toContain('models.yml');
  expect(html).toContain('OPENAI_API_KEY');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('On this page');
});

it('provides direct URLs and useful recovery for unknown documentation topics', () => {
  expect(findDocPage('/docs')?.id).toBe('getting-started');
  expect(findDocPage('/docs/indexing/')?.id).toBe('indexing');
  expect(findDocPage('/docs/unknown')).toBeUndefined();

  const html = renderToStaticMarkup(<DocsPage path="/docs/unknown" />);
  expect(html).toContain('Page not found');
  expect(html).toContain('Getting started');
});

it('makes detailed workflows available as standalone guides', () => {
  for (const id of ['chats', 'browser-use', 'evaluations']) {
    const page = findDocPage(`/docs/${id}`);

    expect(page?.group).toBe('Guides');

    const html = renderToStaticMarkup(<DocsPage path={`/docs/${id}`} />);

    expect(html).toContain(`href="/docs/${id}" aria-current="page"`);
    expect(html).toContain('On this page');
    expect(html).not.toContain('Page not found');
  }
});

it('keeps published topics, cross-links, and section anchors consistent', () => {
  const ids = docPages.map((page) => page.id);
  expect(new Set(ids).size).toBe(ids.length);

  for (const page of docPages) {
    expect(page.content.length).toBeGreaterThan(500);

    const headings = documentHeadings(page.content);
    expect(new Set(headings.map((heading) => heading.id)).size).toBe(headings.length);

    for (const match of page.content.matchAll(/\]\(\/docs\/([a-z-]+)(?:#([a-z-]+))?\)/g)) {
      const target = docPages.find((candidate) => candidate.id === match[1]);
      expect(target, `${page.id} links to missing ${match[1]}`).toBeDefined();

      if (match[2]) expect(documentHeadings(target!.content).map((heading) => heading.id)).toContain(match[2]);
    }
  }
});

it('excludes fenced examples from the page contents', () => {
  const headings = documentHeadings('## Real section\n```md\n## Example heading\n```\n## Next section');

  expect(headings.map((heading) => heading.id)).toEqual(['real-section', 'next-section']);
});

it('renders practical notes without changing local documentation link behavior', () => {
  const page = { ...docPages[0]!, content: '> **Restart required.** See [configuration](/docs/configuration).' };
  const html = renderToStaticMarkup(<DocsArticle page={page} />);

  expect(html).toContain('role="note"');
  expect(html).toContain('Restart required.');
  expect(html).toMatch(/<a href="\/docs\/configuration">/);
});
