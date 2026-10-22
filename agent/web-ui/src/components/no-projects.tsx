import { lazy, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { DocsLink } from './docs-link';
import { LoadingSuspense } from './loading-suspense';

const Settings = lazy(() => import('./settings').then((module) => ({ default: module.Settings })));

export function NoProjects({ onAdd }: { onAdd: () => void }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const close = () => {
    setSettingsOpen(false);
    settingsButton.current?.focus();
  };

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-semibold">Codeberg</span>
        <div className="flex items-center gap-1">
          <button type="button" ref={settingsButton} aria-label="Settings" aria-expanded={settingsOpen}
            onClick={() => settingsOpen ? close() : setSettingsOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <Settings2 className="size-4" aria-hidden="true" />Settings
          </button>
          <DocsLink />
        </div>
      </header>
      {settingsOpen ? <LoadingSuspense label="Loading settings…" className="min-h-0 flex-1">
        <Settings onClose={close} backLabel="Back to setup" />
      </LoadingSuspense> : <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-6 text-center">
        <h1 className="text-lg font-semibold">Add a project to get started</h1>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">Choose a repository to index and explore.</p>
        <button type="button" data-add-project onClick={onAdd}
          className="min-h-11 rounded-lg bg-primary px-4 text-sm text-primary-foreground">
          Add project
        </button>
      </main>}
    </div>
  );
}
