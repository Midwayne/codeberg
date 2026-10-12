import { LoadingBoundary } from '../components/loading';
import { DocsGrid, DocsHeader } from './shell';

export function DocsLoading() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <DocsHeader />
      <DocsGrid>
        <aside aria-hidden="true" className="hidden md:block">
          <div className="ui-loading-scaffold px-3">
            {Array.from({ length: 11 }, (_, index) => <span key={index} className="ui-loading-line" />)}
          </div>
        </aside>
        <LoadingBoundary loading label="Loading documentation…" kind="detail" className="min-h-[60dvh]" />
      </DocsGrid>
    </div>
  );
}
