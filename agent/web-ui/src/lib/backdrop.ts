import type { BackdropScene } from './theme-palettes';

export const BACKDROP_STORAGE_KEY = 'codeberg.backdrop';

/* Backdrops are on unless this browser turned them off. */
export function loadBackdropEnabled(): boolean {
  try {
    return localStorage.getItem(BACKDROP_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/* CSS draws the scene named on the root element; no attribute means no backdrop. */
export function applyBackdrop(scene: BackdropScene | undefined, enabled = loadBackdropEnabled()): void {
  const root = document.documentElement;

  if (scene && enabled) {
    root.dataset.backdrop = scene;
  } else {
    delete root.dataset.backdrop;
  }
}

export function saveBackdropEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(BACKDROP_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* Keep the choice for this page when browser storage is unavailable. */
  }
}
