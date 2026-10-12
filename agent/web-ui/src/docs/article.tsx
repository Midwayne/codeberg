import { Children, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { docPages, documentHeadings, headingId, type DocPage } from './catalog';
import type { TopicMotion } from './routing';
import { DocsNote } from './note';

function sectionHeading({ children }: { children?: ReactNode }) {
  const title = Children.toArray(children).join('');

  return <h2 id={headingId(title)} tabIndex={-1} className="scroll-mt-24">{children}</h2>;
}

function docsLink({ href, children }: { href?: string; children?: ReactNode }) {
  const local = href === '/docs' || href?.startsWith('/docs/') || href?.startsWith('#');

  return <a href={href} target={local ? undefined : '_blank'} rel={local ? undefined : 'noopener noreferrer'}>{children}</a>;
}

const markdownComponents = { h2: sectionHeading, a: docsLink, blockquote: DocsNote };

export function DocsArticle({ page, motion = 'instant' }: { page: DocPage; motion?: TopicMotion }) {
  return (
    <article className={`min-w-0 ${motion === 'instant' ? '' : 'docs-topic-enter'}`} data-direction={motion}>
      <h1 id="doc-title" tabIndex={-1} className="text-3xl font-semibold tracking-tight sm:text-4xl">{page.title}</h1>
      <p className="mt-4 text-base leading-7 text-muted-foreground">{page.summary}</p>
      <div className="docs-prose mt-8">
        <Streamdown mode="static" components={markdownComponents} controls={{ table: false }} linkSafety={{ enabled: false }}>
          {page.content}
        </Streamdown>
      </div>
      <DocsPagination page={page} />
    </article>
  );
}

export function DocsContents({ page }: { page: DocPage }) {
  return (
    <nav aria-label="On this page" className="sticky top-24 space-y-3 text-xs">
      <h2 className="font-semibold">On this page</h2>
      <ul className="space-y-2">
        {documentHeadings(page.content).map(({ id, title }) => (
          <li key={id}><a href={`#${id}`} className="inline-block py-1 text-muted-foreground hover:text-foreground">{title}</a></li>
        ))}
      </ul>
    </nav>
  );
}

function DocsPagination({ page }: { page: DocPage }) {
  const index = docPages.indexOf(page);
  const previous = docPages[index - 1];
  const next = docPages[index + 1];

  return (
    <nav aria-label="Adjacent documentation topics" className="mt-12 flex flex-wrap justify-between gap-4 border-t border-border pt-6 text-sm">
      {previous && <a href={`/docs/${previous.id}`} className="docs-previous inline-flex min-h-11 items-center gap-2 hover:underline"><ArrowLeft aria-hidden="true" className="size-4" />{previous.title}</a>}
      {next && <a href={`/docs/${next.id}`} className="docs-next ml-auto inline-flex min-h-11 items-center gap-2 hover:underline">{next.title}<ArrowRight aria-hidden="true" className="size-4" /></a>}
    </nav>
  );
}
