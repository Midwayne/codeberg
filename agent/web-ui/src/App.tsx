import { PanelLeft, Search, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Workspace } from '@/components/workspace';
import { ModelSettingsPanel } from '@/components/model-settings';

export function App() {
  // The server exposes the model and reasoning effort at /api/meta.
  const [title, setTitle] = useState('');
  const [learningEnabled, setLearningEnabled] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);

  function refreshMeta(): void {
    fetch('/api/meta')
      .then((response) => response.ok ? response.json() : null)
      .then((meta: { title?: string; capabilities?: { learning?: boolean } } | null) => {
        if (meta?.title) setTitle(meta.title);
        setLearningEnabled(meta?.capabilities?.learning === true);
      })
      .catch((err: unknown) => console.warn('failed to load /api/meta', err));
  }

  useEffect(() => {
    refreshMeta();
  }, []);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSettingsOpen(false);
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  function closeSettings(): void {
    setSettingsOpen(false);
    settingsButton.current?.focus();
  }

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
          {title && <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>}
          <button ref={searchButton} type="button" onClick={() => { setSettingsOpen(false); setSearchOpen(true); }} aria-label="Search chats" title="Search chats (⌘K / Ctrl+K)" className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <Search className="size-4" />
          </button>
          <button
            ref={settingsButton}
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Model settings"
            aria-expanded={settingsOpen}
            title="Model settings"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Settings2 className="size-4" />
          </button>
        </div>
      </header>
      <Workspace sidebarOpen={sidebarOpen} learningEnabled={learningEnabled} searchOpen={searchOpen} onSearchClose={() => { setSearchOpen(false); searchButton.current?.focus(); }} />
      {settingsOpen && <ModelSettingsPanel onClose={closeSettings} onSaved={refreshMeta} />}
    </div>
  );
}
