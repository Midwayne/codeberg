import { BookOpen } from 'lucide-react';

export function DocsLink() {
  return (
    <a
      href="/docs/getting-started"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Docs (opens in a new tab)"
      title="Read the documentation in a new tab"
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <BookOpen aria-hidden="true" className="size-4" />
      Docs
    </a>
  );
}
