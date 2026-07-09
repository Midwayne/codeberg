import { PanelLeft } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Workspace } from '@/components/workspace';

export function App() {
  // The server exposes the active model/daemon at /api/meta for the title bar.
  const [subtitle, setSubtitle] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(() => {
    fetch('/api/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((m: { title?: string } | null) => {
        if (m?.title) setSubtitle(m.title);
      })
      .catch((err) => {
        console.warn('failed to load /api/meta', err);
      });
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border">
        <div className="flex items-center gap-2 px-3 py-3 text-sm">
          <button
            type="button"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? 'Hide chats' : 'Show chats'}
            aria-pressed={sidebarOpen}
            title="Toggle chats"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeft className="size-4" />
          </button>
          <span className="font-semibold">codeberg</span>
          {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
        </div>
      </header>
      <Workspace sidebarOpen={sidebarOpen} />
    </div>
  );
}
