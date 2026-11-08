import { ProjectChatsProvider } from './sessions/project-chats';
import { WorkspaceHeader } from './components/workspace/workspace-header';
import { useWorkspaceMeta } from './lib/use-workspace-meta';
import { ProjectShell } from './components/projects';

import type { ReactNode, RefObject } from 'react';

import { lazy } from 'react';

import { Workspace } from './components/workspace/workspace';
import { ModelSettingsPanel } from './components/model-settings';
import { LoadingBoundary } from './components/loading';
import { LoadingSuspense } from './components/loading-suspense';
import { MotionPresence } from './components/motion-presence';

import { useDesktopLayout } from './lib/use-media-query';
import { ScheduleWorkspaceProvider } from './lib/schedule-workspace';
import { useAppSurface } from './lib/use-app-surface';
import type { AppSurface, SurfaceTarget } from './lib/app-surface';
import type { CatalogModel } from '@agent/core/model-types.js';

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

export type ProjectWorkspaceProps = { toolbar: ReactNode; loading: boolean; notice: ReactNode };

export function ProjectWorkspace(props: ProjectWorkspaceProps) {
  const state = useProjectWorkspace(props);

  return (
    <ScheduleWorkspaceProvider enabled={!props.loading} onOpenChat={state.onOpenScheduledChat}>
      <ProjectWorkspaceView {...state} />
    </ScheduleWorkspaceProvider>
  );
}

export type ProjectWorkspaceOptions = {
  toolbar: ReactNode;
  loading: boolean;
  notice: ReactNode;
};

export function useProjectWorkspace({ toolbar, loading, notice }: ProjectWorkspaceOptions): ProjectWorkspaceViewProps {
  const meta = useWorkspaceMeta({ loading });
  const surface = useAppSurface(useDesktopLayout());

  return {
    toolbar,
    loading,
    notice,
    title: meta.title,
    learningBusy: meta.learningBusy,
    trainingEnabled: meta.trainingEnabled,
    learningEnabled: meta.learningEnabled,
    chatInputs: meta.chatInputs,
    refreshMeta: meta.refreshMeta,
    surface: surface.surface,
    sidebarOpen: surface.sidebarOpen,
    searchButton: surface.searchButton,
    settingsButton: surface.settingsButton,
    modelsButton: surface.modelsButton,
    onToggleSidebar: () => surface.setSidebarOpen(!surface.sidebarOpen),
    onCloseSidebar: () => surface.setSidebarOpen(false),
    onActivate: surface.activate,
    onCloseSettings: surface.closeSettings,
    onCloseSearch: surface.closeSearch,
    onCloseModels: surface.closeModels,
    onOpenScheduledChat: surface.openScheduledChat,
  };
}

export type ProjectWorkspaceViewProps = {
  toolbar: ReactNode;
  loading: boolean;
  notice: ReactNode;
  title: string;
  learningBusy: boolean;
  trainingEnabled: boolean;
  learningEnabled: boolean;
  chatInputs: CatalogModel['inputs'];
  refreshMeta: () => void;
  surface: AppSurface;
  sidebarOpen: boolean;
  searchButton: RefObject<HTMLButtonElement | null>;
  settingsButton: RefObject<HTMLButtonElement | null>;
  modelsButton: RefObject<HTMLButtonElement | null>;
  onToggleSidebar: () => void;
  onCloseSidebar: () => void;
  onActivate: (target: SurfaceTarget) => void;
  onCloseSettings: () => void;
  onCloseSearch: () => void;
  onCloseModels: () => void;
  onOpenScheduledChat: () => void;
};

export function ProjectWorkspaceView(state: ProjectWorkspaceViewProps) {
  const chatVisible = state.surface.screen === 'chat';

  return (
    <div className="flex h-dvh min-w-0 flex-col bg-background text-foreground">
      <WorkspaceHeader
        title={state.title}
        learningBusy={state.learningBusy}
        sidebarOpen={state.sidebarOpen}
        surface={state.surface}
        trainingEnabled={state.trainingEnabled}
        onToggleSidebar={state.onToggleSidebar}
        onActivate={state.onActivate}
        searchButton={state.searchButton}
        settingsButton={state.settingsButton}
        modelsButton={state.modelsButton}
      />
      {state.notice}
      <WorkspaceSlot state={state} chatVisible={chatVisible} />
      {state.surface.screen === 'training' && (
        <LoadingSuspense label="Loading training review…" className="min-h-0 flex-1">
          <TrainingReview />
        </LoadingSuspense>
      )}
      {state.surface.screen === 'settings' && (
        <LoadingSuspense label="Loading settings…" className="min-h-0 flex-1">
          <Settings onClose={state.onCloseSettings} onLearningSaved={state.refreshMeta} />
        </LoadingSuspense>
      )}
      <MotionPresence visible={state.surface.overlay === 'models'}>
        <ModelSettingsPanel onClose={state.onCloseModels} onSaved={state.refreshMeta} />
      </MotionPresence>
    </div>
  );
}

function WorkspaceSlot({ state, chatVisible }: { state: ProjectWorkspaceViewProps; chatVisible: boolean }) {
  return (
    <div className={chatVisible ? 'flex min-h-0 flex-1' : 'hidden'}>
      <LoadingBoundary loading={state.loading} label="Loading projects…" kind="workspace" className="min-h-0 flex-1">
        {!state.loading && (
          <Workspace
            projectControls={state.toolbar}
            sidebarOpen={state.sidebarOpen}
            onSidebarClose={state.onCloseSidebar}
            learningEnabled={state.learningEnabled}
            chatInputs={state.chatInputs}
            searchOpen={state.surface.overlay === 'search'}
            onSearchClose={state.onCloseSearch}
          />
        )}
      </LoadingBoundary>
    </div>
  );
}
