import { ArrowLeft, BookOpen } from 'lucide-react';
import { type ReactNode } from 'react';

export function DocsHeader({ search }: { search?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background">
      <div className="mx-auto flex min-h-16 max-w-[1440px] items-center gap-2 px-5 sm:gap-3 sm:px-8">
        <a href="/" className="py-3 text-sm font-semibold">Codeberg</a>
        <span className="flex items-center gap-2 border-l border-border pl-3 text-sm text-muted-foreground"><BookOpen aria-hidden="true" className="hidden size-4 sm:block" />Docs</span>
        <div className="ml-auto">{search}</div>
        <a href="/" aria-label="Back to app" className="docs-action inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-3 text-xs hover:bg-accent">
          <ArrowLeft aria-hidden="true" className="size-4" /><span className="hidden sm:inline">Back to app</span>
        </a>
      </div>
    </header>
  );
}

export function DocsGrid({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-[1440px] gap-8 px-5 py-8 sm:px-8 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-12 md:py-12 xl:grid-cols-[14rem_minmax(0,72ch)_12rem]">
      {children}
    </div>
  );
}
