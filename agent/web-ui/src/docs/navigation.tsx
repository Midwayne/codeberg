import { docGroups, docPages, type DocPage } from './catalog';

export type DocsNavigationProps = {
  current?: DocPage;
};

export function DocsNavigation({ current }: DocsNavigationProps) {
  return (
    <nav aria-label="Documentation topics" className="space-y-6">
      {docGroups.map((group) => <DocsGroup key={group} group={group} pages={docPages} current={current} />)}
    </nav>
  );
}

function DocsGroup({ group, pages, current }: { group: string; pages: DocPage[]; current?: DocPage }) {
  const topics = pages.filter((page) => page.group === group);
  if (!topics.length) return null;

  return (
    <section aria-label={group}>
      <h2 className="mb-2 px-3 text-xs font-semibold text-muted-foreground">{group}</h2>
      <ul className="space-y-1">
        {topics.map((page) => (
          <li key={page.id}>
            <a href={`/docs/${page.id}`} aria-current={page.id === current?.id ? 'page' : undefined}
              className={`flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-accent ${page.id === current?.id ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground'}`}>
              {page.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
