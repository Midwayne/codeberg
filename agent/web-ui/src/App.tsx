import { GraduationCap, PanelLeft, Search, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Workspace } from '@/components/workspace/workspace';
import { ModelSettingsPanel } from '@/components/model-settings';
import { TrainingReview } from '@/components/training-review';
import { loadModelSettings, type CatalogModel } from '@/lib/models';

export function App() {
  // The server exposes the model and reasoning effort at /api/meta.
  const [title, setTitle] = useState('');
  const [chatInputs, setChatInputs] = useState<CatalogModel['inputs']>(['text']);
  const [learningEnabled, setLearningEnabled] = useState(false);
  const [learningBusy, setLearningBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [trainingOpen, setTrainingOpen] = useState(false);
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
    loadModelSettings().then((settings) => {
      setChatInputs(settings.models.find((model) => model.key === settings.chat.key)?.inputs ?? ['text']);
    }).catch((err: unknown) => console.warn('failed to load /api/models', err));
  }

  useEffect(() => {
    refreshMeta();
  }, []);

  useEffect(() => {
    if (!learningEnabled) return;
    let active = true;
    const check = () => {
      void fetch('/api/learning/status').then((response) => response.json()).then((counts: { active: number }) => {
        if (active) setLearningBusy(counts.active > 0);
      }).catch(() => undefined);
    };
    check();
    const timer = setInterval(check, 2000);
    return () => { active = false; clearInterval(timer); setLearningBusy(false); };
  }, [learningEnabled]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSettingsOpen(false);
        setTrainingOpen(false);
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
          {!trainingOpen && <button
            type="button"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? 'Hide chats' : 'Show chats'}
            aria-pressed={sidebarOpen}
            title="Toggle chats"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PanelLeft className="size-4" />
          </button>}
          {title && <span className="min-w-0 flex-1 truncate font-semibold">{trainingOpen ? 'Training review' : title}</span>}
          {learningBusy && <span role="status" className="shrink-0 text-xs text-muted-foreground">Updating knowledge &amp; learning data…</span>}
          <button ref={searchButton} type="button" onClick={() => { setTrainingOpen(false); setSettingsOpen(false); setSearchOpen(true); }} aria-label="Search chats" title="Search chats (⌘K / Ctrl+K)" className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
            <Search className="size-4" />
          </button>
          {learningEnabled && <button type="button" onClick={() => { setTrainingOpen((open) => !open); setSettingsOpen(false); }}
            aria-label={trainingOpen ? 'Back to chats' : 'Training review'} aria-pressed={trainingOpen}
            title={trainingOpen ? 'Back to chats' : 'Review training data'}
            className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground ${trainingOpen ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}>
            <GraduationCap className="size-4" />
          </button>}
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
      <div className={trainingOpen ? 'hidden' : 'flex min-h-0 flex-1'}>
        <Workspace sidebarOpen={sidebarOpen} learningEnabled={learningEnabled} chatInputs={chatInputs} searchOpen={searchOpen} onSearchClose={() => { setSearchOpen(false); searchButton.current?.focus(); }} />
      </div>
      {trainingOpen && <TrainingReview />}
      {settingsOpen && <ModelSettingsPanel onClose={closeSettings} onSaved={refreshMeta} />}
    </div>
  );
}
