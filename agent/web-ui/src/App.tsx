import { ProjectChatsProvider } from './sessions/project-chats';
import { WorkspaceHeader } from './components/workspace/workspace-header';
import { useWorkspaceMeta } from './lib/use-workspace-meta';
import { ProjectShell } from './components/projects';

import type { ReactNode } from 'react';

import { lazy, useEffect, useRef, useState } from 'react';

import { Workspace } from './components/workspace/workspace';
import { ModelSettingsPanel } from './components/model-settings';
import { LoadingBoundary } from './components/loading';
import { LoadingSuspense } from './components/loading-suspense';
import { MotionPresence } from './components/motion-presence';

import { useMediaQuery } from './lib/use-media-query';
import { ScheduleWorkspaceProvider } from './lib/schedule-workspace';
import { WhatsNew } from './whats-new/whats-new';

// Secondary screens load only when opened; the chat stays on the critical path.
const Settings = lazy(() => import('@/components/settings').then((module) => ({ default: module.Settings })));
const TrainingReview = lazy(() =>
  import('@/components/training-review').then((module) => ({ default: module.TrainingReview })),
);

export function App() {
  return (
    <ProjectChatsProvider>
      <ProjectShell>
        {(toolbar, loading, notice) => <ProjectWorkspace toolbar={toolbar} loading={loading} notice={notice} />}
      </ProjectShell>
    </ProjectChatsProvider>
  );
}

type ProjectWorkspaceProps = { toolbar: ReactNode; loading: boolean; notice: ReactNode };

function ProjectWorkspace(props: ProjectWorkspaceProps) {
  const state = useProjectWorkspace(props);

  return <ScheduleWorkspaceProvider enabled={!props.loading} onOpenChat={() => {
    state.setSettingsOpen(false);
    state.setTrainingOpen(false);
    state.setModelsOpen(false);
    if (state.settingsOpen) state.settingsButton.current?.focus();

    if (!state.desktop) state.setSidebarOpen(false);
  }}><ProjectWorkspaceView {...state} /></ScheduleWorkspaceProvider>;
}

type ProjectWorkspaceOptions = {
  toolbar: ReactNode;
  loading: boolean;
  notice: ReactNode;
};

export function useProjectWorkspace({ toolbar, loading, notice }: ProjectWorkspaceOptions) {
  const meta = useWorkspaceMeta({ loading });
  const panels = useWorkspacePanels();

  return { ...meta, ...panels, notice, loading, toolbar };
}

/** Which secondary screens are open, and the buttons that get focus back when they close. */
function useWorkspacePanels() {
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

  function openSearch(): void {
    setSettingsOpen(false);
    setModelsOpen(false);
    setTrainingOpen(false);
    if (!desktop) setSidebarOpen(false);
    setSearchOpen(true);
  }

  function closeSettings(): void {
    setSettingsOpen(false);
    settingsButton.current?.focus();
  }

  useSearchShortcut(openSearch, desktop);

  return {
    desktop,
    sidebarOpen,
    setSidebarOpen,
    settingsOpen,
    setSettingsOpen,
    modelsOpen,
    setModelsOpen,
    searchOpen,
    setSearchOpen,
    trainingOpen,
    setTrainingOpen,
    searchButton,
    settingsButton,
    modelsButton,
    closeSettings,
  };
}

type ProjectWorkspaceViewProps = ReturnType<typeof useProjectWorkspace>;

export function ProjectWorkspaceView(state: ProjectWorkspaceViewProps) {
  return (
    <div className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
      <WorkspaceHeader state={state} />
      {state.notice}
      <div className={state.trainingOpen || state.settingsOpen ? 'hidden' : 'flex min-h-0 flex-1'}>
        <LoadingBoundary loading={state.loading} label="Loading projects…" kind="workspace" className="min-h-0 flex-1">
          {!state.loading && <Workspace
            projectControls={state.toolbar}
            sidebarOpen={state.sidebarOpen && !state.settingsOpen && !state.trainingOpen}
            onSidebarClose={() => state.setSidebarOpen(false)}
            learningEnabled={state.learningEnabled}
            chatModels={state.chatModels}
            searchOpen={state.searchOpen}
            onSearchClose={() => {
              state.setSearchOpen(false);
              state.searchButton.current?.focus();
            }}
          />}
        </LoadingBoundary>
      </div>
      {state.trainingOpen && (
        <LoadingSuspense label="Loading training review…" className="min-h-0 flex-1">
          <TrainingReview />
        </LoadingSuspense>
      )}
      {state.settingsOpen && (
        <LoadingSuspense label="Loading settings…" className="min-h-0 flex-1">
          <Settings onClose={state.closeSettings} onLearningSaved={state.refreshMeta} />
        </LoadingSuspense>
      )}
      <MotionPresence visible={state.modelsOpen}>
        <ModelSettingsPanel
          onClose={() => {
            state.setModelsOpen(false);
            state.modelsButton.current?.focus();
          }}
          onSaved={state.refreshMeta}
        />
      </MotionPresence>
      <WhatsNew enabled={!state.loading} />
    </div>
  );
}

/** Cmd/Ctrl+K opens chat search. `onOpen` is re-read whenever the layout it depends on changes. */
function useSearchShortcut(onOpen: () => void, desktop: boolean) {
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpen();
      }
    };

    window.addEventListener('keydown', shortcut);

    return () => window.removeEventListener('keydown', shortcut);
  }, [desktop]);
}
