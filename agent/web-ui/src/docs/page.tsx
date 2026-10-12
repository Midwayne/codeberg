import { useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { findDocPage } from './catalog';
import { DocsNavigation } from './navigation';
import { DocsArticle, DocsContents } from './article';
import { useDocsRoute } from './use-docs-route';
import { DocsGrid, DocsHeader } from './shell';
import { useDocsSearch } from './use-docs-search';
import { DocsSearchTrigger } from './search-trigger';
import { DocsSearchDialog } from './search-dialog';
import './styles.css';
import './motion.css';

export function DocsPage({ path = window.location.pathname }: { path?: string }) {
  const route = useDocsRoute(path);
  const page = findDocPage(route.path);
  const search = useDocsSearch();

  useEffect(() => {
    document.title = `${page?.title ?? 'Page not found'} · Codeberg Docs`;
  }, [page]);

  return (
    <div onClick={route.navigate} className="min-h-dvh bg-background text-foreground">
      <a href="#docs-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:p-3 focus:text-primary-foreground">Skip to documentation</a>
      <DocsHeader search={<DocsSearchTrigger onClick={search.show} />} />
      <DocsGrid>
        <aside className="min-w-0">
          <div className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] overflow-y-auto md:block"><DocsNavigation current={page} /></div>
          <details key={route.path} className="docs-mobile-navigation rounded-lg border border-border md:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm">Browse documentation<ChevronDown aria-hidden="true" className="docs-chevron size-4" /></summary>
            <div className="docs-mobile-topics border-t border-border p-3"><DocsNavigation current={page} /></div>
          </details>
        </aside>
        <main id="docs-content" tabIndex={-1} className="min-w-0 max-w-[72ch]">
          {page ? <DocsArticle key={page.id} page={page} motion={route.motion} /> : <MissingTopic />}
        </main>
        {page && <aside className="hidden xl:block"><DocsContents page={page} /></aside>}
      </DocsGrid>
      {search.open && <DocsSearchDialog onClose={search.close} onSelect={route.select} />}
    </div>
  );
}

function MissingTopic() {
  return (
    <section>
      <h1 className="text-3xl font-semibold">Page not found</h1>
      <p className="mt-4 leading-7 text-muted-foreground">This documentation topic does not exist. Choose a topic in the navigation or start with the setup guide.</p>
      <a href="/docs/getting-started" className="mt-6 inline-flex min-h-11 items-center gap-2 underline">Getting started<ChevronDown aria-hidden="true" className="size-4" /></a>
    </section>
  );
}
