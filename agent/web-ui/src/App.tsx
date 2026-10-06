import { WorkspaceHeader } from './components/workspace/workspace-header';
import { useWorkspaceMeta } from './lib/use-workspace-meta';
import { ProjectShell } from './components/projects';

import type { ReactNode } from 'react';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { Workspace } from './components/workspace/workspace';
import { ModelSettingsPanel } from './components/model-settings';

import { useMediaQuery } from './lib/use-media-query';

// Secondary screens load only when opened; the chat stays on the critical path.
const Settings = lazy(() => import('@/components/settings').then((module) => ({ default: module.Settings })));
const TrainingReview = lazy(() =>
  import('@/components/training-review').then((module) => ({ default: module.TrainingReview })),
);

export function App() {
  return (
    <ProjectShell>
      {(toolbar, loading, notice) => <ProjectWorkspace toolbar={toolbar} loading={loading} notice={notice} />}
    </ProjectShell>
  );
}

export type ProjectWorkspaceProps = { toolbar: ReactNode; loading: boolean; notice: ReactNode };

export function ProjectWorkspace(props: ProjectWorkspaceProps) {
  const state = useProjectWorkspace(props);

  return <ProjectWorkspaceView {...state} />;
}

export type ProjectWorkspaceOptions = {
  toolbar: ReactNode;
  loading: boolean;
  notice: ReactNode;
};

export function useProjectWorkspace({ toolbar, loading, notice }: ProjectWorkspaceOptions) {
  const { title, chatInputs, learningEnabled, trainingEnabled, learningBusy, refreshMeta } = useWorkspaceMeta({
    loading,
  });

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
  useSearchShortcut({ setSettingsOpen, setModelsOpen, setTrainingOpen, desktop, setSidebarOpen, setSearchOpen });

  function closeSettings(): void {
    setSettingsOpen(false);
    settingsButton.current?.focus();
  }
  return {
    trainingOpen,
    settingsOpen,
    setSidebarOpen,
    sidebarOpen,
    title,
    learningBusy,
    searchButton,
    setTrainingOpen,
    setSettingsOpen,
    desktop,
    setSearchOpen,
    trainingEnabled,
    setModelsOpen,
    modelsButton,
    modelsOpen,
    settingsButton,
    notice,
    loading,
    toolbar,
    learningEnabled,
    chatInputs,
    searchOpen,
    closeSettings,
    refreshMeta,
  };
}

export type ProjectWorkspaceViewProps = ReturnType<typeof useProjectWorkspace>;

export function ProjectWorkspaceView(state: ProjectWorkspaceViewProps) {
  return (
    <div className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
      <WorkspaceHeader state={state} />
      {state.notice}
      <div className={state.trainingOpen || state.settingsOpen ? 'hidden' : 'flex min-h-0 flex-1'}>
        {state.loading ? (
          <PanelLoading label="Loading projects…" />
        ) : (
          <Workspace
            projectControls={state.toolbar}
            sidebarOpen={state.sidebarOpen && !state.settingsOpen && !state.trainingOpen}
            onSidebarClose={() => state.setSidebarOpen(false)}
            learningEnabled={state.learningEnabled}
            chatInputs={state.chatInputs}
            searchOpen={state.searchOpen}
            onSearchClose={() => {
              state.setSearchOpen(false);
              state.searchButton.current?.focus();
            }}
          />
        )}
      </div>
      {state.trainingOpen && (
        <Suspense fallback={<PanelLoading label="Loading training review…" />}>
          <TrainingReview />
        </Suspense>
      )}
      {state.settingsOpen && (
        <Suspense fallback={<PanelLoading label="Loading settings…" />}>
          <Settings onClose={state.closeSettings} onLearningSaved={state.refreshMeta} />
        </Suspense>
      )}
      {state.modelsOpen && (
        <ModelSettingsPanel
          onClose={() => {
            state.setModelsOpen(false);
            state.modelsButton.current?.focus();
          }}
          onSaved={state.refreshMeta}
        />
      )}
    </div>
  );
}

export type PanelLoadingProps = { label: string };

function PanelLoading({ label }: PanelLoadingProps) {
  return (
    <main role="status" className="min-h-0 flex-1 p-6 text-sm text-muted-foreground">
      {label}
    </main>
  );
}

export type SearchShortcutOptions = {
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setModelsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTrainingOpen: React.Dispatch<React.SetStateAction<boolean>>;
  desktop: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean | undefined>>;
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

function useSearchShortcut({
  setSettingsOpen,
  setModelsOpen,
  setTrainingOpen,
  desktop,
  setSidebarOpen,
  setSearchOpen,
}: SearchShortcutOptions) {
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
}
