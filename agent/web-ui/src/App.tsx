import { ProjectShell } from '@/components/projects';
import { useProjectApi } from '@/lib/project-api';
import type { ReactNode } from 'react';
import { GraduationCap, PanelLeft, Search, Settings2, SlidersHorizontal } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { Workspace } from '@/components/workspace/workspace';
import { ModelSettingsPanel } from '@/components/model-settings';
import { loadModelSettings, type CatalogModel } from '@/lib/models';
import { loadLearningSettings } from '@/lib/learning-settings';
import { startLearningStatusPolling } from '@/lib/learning-status';
import { IconButton } from '@/components/ui';
import { useMediaQuery } from '@/lib/use-media-query';

// Secondary screens load only when opened; the chat stays on the critical path.
const Settings = lazy(() => import('@/components/settings').then((module) => ({ default: module.Settings })));
const TrainingReview = lazy(() => import('@/components/training-review').then((module) => ({ default: module.TrainingReview })));

export function App() {
  return <ProjectShell>{(toolbar, loading, notice) => <ProjectWorkspace toolbar={toolbar} loading={loading} notice={notice} />}</ProjectShell>;
}

function ProjectWorkspace({ toolbar, loading, notice }: { toolbar: ReactNode; loading: boolean; notice: ReactNode }) {
  const { fetch: api } = useProjectApi();
  // The server exposes the model and reasoning effort at /api/meta.
  const [title, setTitle] = useState('');
  const [chatInputs, setChatInputs] = useState<CatalogModel['inputs']>(['text']);
  const [learningEnabled, setLearningEnabled] = useState(false);
  const [learningActive, setLearningActive] = useState(false);
  const [trainingEnabled, setTrainingEnabled] = useState(false);
  const [learningBusy, setLearningBusy] = useState(false);
  const desktop = useMediaQuery('(min-width: 768px)');
  const [sidebarPreference, setSidebarOpen] = useState<boolean>();
  const sidebarOpen = sidebarPreference ?? desktop;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [trainingOpen, setTrainingOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const modelsButton = useRef<HTMLButtonElement>(null);

  function refreshMeta(): void {
    api('/api/meta')
      .then((response) => response.ok ? response.json() : null)
      .then((meta: { title?: string; capabilities?: { learning?: boolean } } | null) => {
        if (meta?.title) setTitle(meta.title);
        setLearningEnabled(meta?.capabilities?.learning === true);
      })
      .catch((err: unknown) => console.warn('failed to load /api/meta', err));
    void loadLearningSettings(api).then((settings) => {
      setLearningActive(Boolean(settings?.enabled));
      setTrainingEnabled(Boolean(settings?.enabled && settings.datasets && (settings.training || settings.evals)));
    }).catch((err: unknown) => console.warn('failed to load learning settings', err));
    loadModelSettings().then((settings) => {
      setChatInputs(settings.models.find((model) => model.key === settings.chat.key)?.inputs ?? ['text']);
    }).catch((err: unknown) => console.warn('failed to load /api/models', err));
  }

  useEffect(() => {
    if (!loading) refreshMeta();
  }, [api, loading]);

  useEffect(() => {
    if (!learningActive) { setLearningBusy(false); return; }
    return startLearningStatusPolling(setLearningBusy, api);
  }, [learningActive, api]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSettingsOpen(false);
        setModelsOpen(false);
        setTrainingOpen(false);
        if (!desktop) setSidebarOpen(false);
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [desktop]);

  function closeSettings(): void {
    setSettingsOpen(false);
    settingsButton.current?.focus();
  }

  return (
    <div className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border">
        <div className="flex min-h-16 flex-wrap items-center gap-1 px-2 text-sm sm:gap-2 sm:px-4">
          {!trainingOpen && !settingsOpen && <IconButton
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? 'Hide chats' : 'Show chats'}
            aria-expanded={sidebarOpen}
            aria-controls="chat-sidebar"
            title="Toggle chats"
          >
            <PanelLeft className="size-4" />
          </IconButton>}
          <span className="shrink-0 px-1 font-semibold max-[359px]:text-xs">Codeberg</span>
          <span className="ml-2 hidden min-w-0 flex-1 truncate border-l border-border pl-4 text-xs text-muted-foreground md:block" title={title}>
            {settingsOpen ? 'Settings' : trainingOpen ? 'Training review' : title}
          </span>
          {learningBusy && <span role="status" title="Updating knowledge and learning data" className="hidden shrink-0 text-xs text-muted-foreground lg:block">Updating knowledge &amp; learning data…</span>}
          <IconButton ref={searchButton} onClick={() => { setTrainingOpen(false); setSettingsOpen(false); if (!desktop) setSidebarOpen(false); setSearchOpen(true); }} aria-label="Search chats" title="Search chats (⌘K / Ctrl+K)" className="ml-auto gap-2 md:w-auto md:px-3">
            <Search className="size-4" />
            <span className="hidden text-xs md:inline">Search</span>
          </IconButton>
          {trainingEnabled && <IconButton onClick={() => { setTrainingOpen((open) => !open); setSettingsOpen(false); setModelsOpen(false); if (!desktop) setSidebarOpen(false); }}
            aria-label={trainingOpen ? 'Back to chats' : 'Training review'} aria-pressed={trainingOpen}
            title={trainingOpen ? 'Back to chats' : 'Review training data'}
            className={`gap-2 md:w-auto md:px-3 ${trainingOpen ? 'bg-accent text-foreground' : ''}`}>
            <GraduationCap className="size-4" />
            <span className="hidden text-xs md:inline">Training</span>
          </IconButton>}
          <IconButton ref={modelsButton} onClick={() => { setModelsOpen((open) => !open); if (!desktop) setSidebarOpen(false); }}
            aria-label="Model settings" aria-expanded={modelsOpen} title="Model settings"
            className="gap-2 md:w-auto md:px-3">
            <SlidersHorizontal className="size-4" />
            <span className="hidden text-xs md:inline">Models</span>
          </IconButton>
          <IconButton
            ref={settingsButton}
            onClick={() => { setSettingsOpen((open) => !open); setTrainingOpen(false); setSearchOpen(false); setModelsOpen(false); if (!desktop) setSidebarOpen(false); }}
            aria-label="Settings"
            aria-expanded={settingsOpen}
            title="Settings"
            className={`gap-2 md:w-auto md:px-3 ${settingsOpen ? 'bg-accent text-foreground' : ''}`}
          >
            <Settings2 className="size-4" />
            <span className="hidden text-xs md:inline">Settings</span>
          </IconButton>
        </div>
      </header>
      {notice}
      <div className={trainingOpen || settingsOpen ? 'hidden' : 'flex min-h-0 flex-1'}>
        {loading ? <PanelLoading label="Loading projects…" /> : <Workspace projectControls={toolbar} sidebarOpen={sidebarOpen && !settingsOpen && !trainingOpen} onSidebarClose={() => setSidebarOpen(false)} learningEnabled={learningEnabled} chatInputs={chatInputs} searchOpen={searchOpen} onSearchClose={() => { setSearchOpen(false); searchButton.current?.focus(); }} />}
      </div>
      {trainingOpen && <Suspense fallback={<PanelLoading label="Loading training review…" />}><TrainingReview /></Suspense>}
      {settingsOpen && <Suspense fallback={<PanelLoading label="Loading settings…" />}><Settings onClose={closeSettings} onLearningSaved={refreshMeta} /></Suspense>}
      {modelsOpen && <ModelSettingsPanel onClose={() => { setModelsOpen(false); modelsButton.current?.focus(); }} onSaved={refreshMeta} />}
    </div>
  );
}

function PanelLoading({ label }: { label: string }) {
  return <main role="status" className="min-h-0 flex-1 p-6 text-sm text-muted-foreground">{label}</main>;
}
