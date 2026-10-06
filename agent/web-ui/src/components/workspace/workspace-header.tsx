import { GraduationCap, PanelLeft, Search, Settings2, SlidersHorizontal } from 'lucide-react';

import { IconButton } from '../ui';

import { type ProjectWorkspaceView, type useProjectWorkspace } from '../../App';

export type WorkspaceHeaderProps = { state: Parameters<typeof ProjectWorkspaceView>[0] };

export function WorkspaceHeader({ state }: WorkspaceHeaderProps) {
  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex min-h-16 flex-wrap items-center gap-1 px-2 text-sm sm:gap-2 sm:px-4">
        {!state.trainingOpen && !state.settingsOpen && (
          <IconButton
            onClick={() => state.setSidebarOpen(!state.sidebarOpen)}
            aria-label={state.sidebarOpen ? 'Hide chats' : 'Show chats'}
            aria-expanded={state.sidebarOpen}
            aria-controls="chat-sidebar"
            title="Toggle chats"
          >
            <PanelLeft className="size-4" />
          </IconButton>
        )}
        <span className="shrink-0 px-1 font-semibold max-[359px]:text-xs">Codeberg</span>
        <span
          className="ml-2 hidden min-w-0 flex-1 truncate border-l border-border pl-4 text-xs text-muted-foreground md:block"
          title={state.title}
        >
          {state.settingsOpen ? 'Settings' : state.trainingOpen ? 'Training review' : state.title}
        </span>
        {state.learningBusy && (
          <span
            role="status"
            title="Updating knowledge and learning data"
            className="hidden shrink-0 text-xs text-muted-foreground lg:block"
          >
            Updating knowledge &amp; learning data…
          </span>
        )}
        <SearchButton state={state} />
        <TrainingButton state={state} />
        <ModelsButton state={state} />
        <SettingsButton state={state} />
      </div>
    </header>
  );
}

export type TrainingButtonProps = { state: ReturnType<typeof useProjectWorkspace> };

export function TrainingButton({ state }: TrainingButtonProps) {
  return (
    state.trainingEnabled && (
      <IconButton
        onClick={() => {
          state.setTrainingOpen((open) => !open);
          state.setSettingsOpen(false);
          state.setModelsOpen(false);
          if (!state.desktop) state.setSidebarOpen(false);
        }}
        aria-label={state.trainingOpen ? 'Back to chats' : 'Training review'}
        aria-pressed={state.trainingOpen}
        title={state.trainingOpen ? 'Back to chats' : 'Review training data'}
        className={`gap-2 md:w-auto md:px-3 ${state.trainingOpen ? 'bg-accent text-foreground' : ''}`}
      >
        <GraduationCap className="size-4" />
        <span className="hidden text-xs md:inline">Training</span>
      </IconButton>
    )
  );
}

export type ModelsButtonProps = { state: ReturnType<typeof useProjectWorkspace> };

export function ModelsButton({ state }: ModelsButtonProps) {
  return (
    <IconButton
      ref={state.modelsButton}
      onClick={() => {
        state.setModelsOpen((open) => !open);
        if (!state.desktop) state.setSidebarOpen(false);
      }}
      aria-label="Model settings"
      aria-expanded={state.modelsOpen}
      title="Model settings"
      className="gap-2 md:w-auto md:px-3"
    >
      <SlidersHorizontal className="size-4" />
      <span className="hidden text-xs md:inline">Models</span>
    </IconButton>
  );
}

export type SettingsButtonProps = { state: ReturnType<typeof useProjectWorkspace> };

export function SettingsButton({ state }: SettingsButtonProps) {
  return (
    <IconButton
      ref={state.settingsButton}
      onClick={() => {
        state.setSettingsOpen((open) => !open);
        state.setTrainingOpen(false);
        state.setSearchOpen(false);
        state.setModelsOpen(false);
        if (!state.desktop) state.setSidebarOpen(false);
      }}
      aria-label="Settings"
      aria-expanded={state.settingsOpen}
      title="Settings"
      className={`gap-2 md:w-auto md:px-3 ${state.settingsOpen ? 'bg-accent text-foreground' : ''}`}
    >
      <Settings2 className="size-4" />
      <span className="hidden text-xs md:inline">Settings</span>
    </IconButton>
  );
}

export type SearchButtonProps = { state: ReturnType<typeof useProjectWorkspace> };

export function SearchButton({ state }: SearchButtonProps) {
  return (
    <IconButton
      ref={state.searchButton}
      onClick={() => {
        state.setTrainingOpen(false);
        state.setSettingsOpen(false);
        if (!state.desktop) state.setSidebarOpen(false);
        state.setSearchOpen(true);
      }}
      aria-label="Search chats"
      title="Search chats (⌘K / Ctrl+K)"
      className="ml-auto gap-2 md:w-auto md:px-3"
    >
      <Search className="size-4" />
      <span className="hidden text-xs md:inline">Search</span>
    </IconButton>
  );
}
