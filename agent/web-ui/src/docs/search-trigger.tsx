import { Search } from 'lucide-react';

export function DocsSearchTrigger({ onClick }: { onClick: () => void }) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcut = mac ? '⌘K' : 'Ctrl K';

  return (
    <button type="button" onClick={onClick} aria-label="Search documentation" aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K"
      title={`Search documentation (${shortcut})`}
      className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-3 text-xs hover:bg-accent">
      <Search aria-hidden="true" className="size-4" />
      <span className="hidden sm:inline">Search docs</span>
      <span aria-hidden="true" className="ml-1 hidden text-muted-foreground sm:inline">{shortcut}</span>
    </button>
  );
}
