import { PanelLeft, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Workspace } from '@/components/workspace';
import { ModelSettingsPanel } from '@/components/model-settings';

export function App() {
  // The server exposes the model and reasoning effort at /api/meta.
  const [title, setTitle] = useState('');
  const [learningEnabled, setLearningEnabled] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
          <button
            ref={settingsButton}
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Model settings"
            aria-expanded={settingsOpen}
            title="Model settings"
            className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Settings2 className="size-4" />
          </button>
        </div>
      </header>
      <Workspace sidebarOpen={sidebarOpen} learningEnabled={learningEnabled} />
      {settingsOpen && <ModelSettingsPanel onClose={closeSettings} onSaved={refreshMeta} />}
    </div>
  );
}
