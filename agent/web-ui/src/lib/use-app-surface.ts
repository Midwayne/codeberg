import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

import {
  CHAT_SURFACE,
  clearOverlay,
  dismissScreen,
  openSurface,
  type AppSurface,
  type SurfaceTarget,
} from './app-surface';

export type AppSurfaceControls = {
  surface: AppSurface;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  searchButton: RefObject<HTMLButtonElement | null>;
  settingsButton: RefObject<HTMLButtonElement | null>;
  modelsButton: RefObject<HTMLButtonElement | null>;
  activate: (target: SurfaceTarget) => void;
  closeSettings: () => void;
  closeSearch: () => void;
  closeModels: () => void;
  openScheduledChat: () => void;
};

export function useAppSurface(desktop: boolean): AppSurfaceControls {
  const [surface, setSurface] = useState<AppSurface>(CHAT_SURFACE);
  const [sidebarPreference, setSidebarPreference] = useState<boolean>();
  const searchButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const modelsButton = useRef<HTMLButtonElement>(null);
  const activate = useSurfaceActivation(desktop, setSurface, setSidebarPreference);

  useSearchShortcut(activate);

  const closers = surfaceClosers(surface, setSurface, { searchButton, settingsButton, modelsButton }, activate);

  return {
    surface,
    sidebarOpen: sidebarPreference ?? desktop,
    setSidebarOpen: setSidebarPreference,
    searchButton,
    settingsButton,
    modelsButton,
    activate,
    ...closers,
  };
}

function useSurfaceActivation(
  desktop: boolean,
  setSurface: Dispatch<SetStateAction<AppSurface>>,
  setSidebarOpen: Dispatch<SetStateAction<boolean | undefined>>,
) {
  return useCallback((target: SurfaceTarget) => {
    setSurface((current) => openSurface(current, target));

    if (!desktop) setSidebarOpen(false);
  }, [desktop, setSurface, setSidebarOpen]);
}

function useSearchShortcut(activate: (target: SurfaceTarget) => void) {
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;

      event.preventDefault();
      activate('search');
    };

    window.addEventListener('keydown', shortcut);

    return () => window.removeEventListener('keydown', shortcut);
  }, [activate]);
}

type SurfaceButtons = {
  searchButton: RefObject<HTMLButtonElement | null>;
  settingsButton: RefObject<HTMLButtonElement | null>;
  modelsButton: RefObject<HTMLButtonElement | null>;
};

function surfaceClosers(
  surface: AppSurface,
  setSurface: Dispatch<SetStateAction<AppSurface>>,
  buttons: SurfaceButtons,
  activate: (target: SurfaceTarget) => void,
) {
  return {
    closeSettings() {
      setSurface((current) => dismissScreen(current));
      buttons.settingsButton.current?.focus();
    },
    closeSearch() {
      setSurface((current) => clearOverlay(current));
      buttons.searchButton.current?.focus();
    },
    closeModels() {
      setSurface((current) => clearOverlay(current));
      buttons.modelsButton.current?.focus();
    },
    openScheduledChat() {
      if (surface.screen === 'settings') buttons.settingsButton.current?.focus();

      activate('chat');
    },
  };
}
