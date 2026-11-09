import { GraduationCap, PanelLeft, Search, Settings2, SlidersHorizontal } from 'lucide-react';

import type { RefObject } from 'react';

import { IconButton } from '../ui';
import { DocsLink } from '../docs-link';
import type { AppSurface, SurfaceTarget } from '../../lib/app-surface';
import { useFocusSlot } from '../../lib/focus-registry';
import { mergeRefs } from '../../lib/merge-refs';

export type WorkspaceHeaderProps = {
  title: string;
  learningBusy: boolean;
  sidebarOpen: boolean;
  surface: AppSurface;
  trainingEnabled: boolean;
  onToggleSidebar: () => void;
  onActivate: (target: SurfaceTarget) => void;
  searchButton: RefObject<HTMLButtonElement | null>;
  settingsButton: RefObject<HTMLButtonElement | null>;
  modelsButton: RefObject<HTMLButtonElement | null>;
};

export function WorkspaceHeader({
  title,
  learningBusy,
  sidebarOpen,
  surface,
  trainingEnabled,
  onToggleSidebar,
  onActivate,
  searchButton,
  settingsButton,
  modelsButton,
}: WorkspaceHeaderProps) {
  return (
    <header className="shrink-0 border-b border-border">
      <div className="flex min-h-16 flex-wrap items-center gap-1 px-2 text-sm sm:gap-2 sm:px-4">
        {surface.screen === 'chat' && (
          <IconButton
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? 'Hide chats' : 'Show chats'}
            aria-expanded={sidebarOpen}
            aria-controls="chat-sidebar"
            title="Toggle chats"
          >
            <PanelLeft className="size-4" />
          </IconButton>
        )}
        <span className="shrink-0 px-1 font-semibold max-[359px]:text-xs">Codeberg</span>
        <HeaderTitle title={title} surface={surface} />
        {learningBusy && (
          <span
            role="status"
            title="Updating knowledge and learning data"
            className="hidden shrink-0 text-xs text-muted-foreground lg:block"
          >
            Updating knowledge &amp; learning data…
          </span>
        )}
        <SearchButton buttonRef={searchButton} onActivate={() => onActivate('search')} />
        <TrainingButton enabled={trainingEnabled} open={surface.screen === 'training'} onActivate={() => onActivate('training')} />
        <ModelsButton open={surface.overlay === 'models'} buttonRef={modelsButton} onActivate={() => onActivate('models')} />
        <SettingsButton open={surface.screen === 'settings'} buttonRef={settingsButton} onActivate={() => onActivate('settings')} />
        <DocsLink />
      </div>
    </header>
  );
}

function HeaderTitle({ title, surface }: { title: string; surface: AppSurface }) {
  return (
    <span
      className="ml-2 hidden min-w-0 flex-1 truncate border-l border-border pl-4 text-xs text-muted-foreground md:block"
      title={title}
    >
      {screenTitle(surface, title)}
    </span>
  );
}

function screenTitle(surface: AppSurface, title: string): string {
  switch (surface.screen) {
    case 'settings':
      return 'Settings';
    case 'training':
      return 'Training review';
    case 'chat':
      return title;
    default: {
      const exhaustive: never = surface.screen;
      return exhaustive;
    }
  }
}

type TrainingButtonProps = {
  enabled: boolean;
  open: boolean;
  onActivate: () => void;
};

export function TrainingButton({ enabled, open, onActivate }: TrainingButtonProps) {
  if (!enabled) return null;

  return (
    <IconButton
      onClick={onActivate}
      aria-label={open ? 'Back to chats' : 'Training review'}
      aria-pressed={open}
      title={open ? 'Back to chats' : 'Review training data'}
      className={`gap-2 md:w-auto md:px-3 ${open ? 'bg-accent text-foreground' : ''}`}
    >
      <GraduationCap className="size-4" />
      <span className="hidden text-xs md:inline">Training</span>
    </IconButton>
  );
}

type ModelsButtonProps = {
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onActivate: () => void;
};

export function ModelsButton({ open, buttonRef, onActivate }: ModelsButtonProps) {
  return (
    <IconButton
      ref={buttonRef}
      onClick={onActivate}
      aria-label="Model settings"
      aria-expanded={open}
      title="Model settings"
      className="gap-2 md:w-auto md:px-3"
    >
      <SlidersHorizontal className="size-4" />
      <span className="hidden text-xs md:inline">Models</span>
    </IconButton>
  );
}

type SettingsButtonProps = {
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onActivate: () => void;
};

export function SettingsButton({ open, buttonRef, onActivate }: SettingsButtonProps) {
  const settingsSlot = useFocusSlot<HTMLButtonElement>('settings');

  return (
    <IconButton
      ref={mergeRefs(buttonRef, settingsSlot)}
      onClick={onActivate}
      aria-label="Settings"
      aria-expanded={open}
      title="Settings"
      className={`gap-2 md:w-auto md:px-3 ${open ? 'bg-accent text-foreground' : ''}`}
    >
      <Settings2 className="size-4" />
      <span className="hidden text-xs md:inline">Settings</span>
    </IconButton>
  );
}

type SearchButtonProps = {
  buttonRef: RefObject<HTMLButtonElement | null>;
  onActivate: () => void;
};

export function SearchButton({ buttonRef, onActivate }: SearchButtonProps) {
  return (
    <IconButton
      ref={buttonRef}
      onClick={onActivate}
      aria-label="Search chats"
      title="Search chats (⌘K / Ctrl+K)"
      className="ml-auto gap-2 md:w-auto md:px-3"
    >
      <Search className="size-4" />
      <span className="hidden text-xs md:inline">Search</span>
    </IconButton>
  );
}
