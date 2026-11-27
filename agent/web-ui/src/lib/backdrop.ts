import type { Theme } from './theme-types';

export const BACKDROP_STORAGE_KEY = 'codeberg.backdrop';

/* The choice made on this page, used when browser storage cannot keep it. */
let pageChoice: boolean | undefined;

/* Backdrops are on unless this browser, or this page, turned them off. */
export function loadBackdropEnabled(): boolean {
  try {
    const stored = localStorage.getItem(BACKDROP_STORAGE_KEY);

    return stored === null ? (pageChoice ?? true) : stored !== 'off';
  } catch {
    return pageChoice ?? true;
  }
}

/*
 * CSS draws the scene named on the root element; no attribute means no backdrop.
 * A generated backdrop is named `custom` and its layers are drawn by ChatBackdrop.
 */
export function applyBackdrop(backdrop: Theme['backdrop'], enabled = loadBackdropEnabled()): void {
  const root = document.documentElement;

  if (backdrop && enabled) {
    root.dataset.backdrop = typeof backdrop === 'string' ? backdrop : 'custom';
  } else {
    delete root.dataset.backdrop;
  }
}

export function saveBackdropEnabled(enabled: boolean): void {
  pageChoice = enabled;

  try {
    localStorage.setItem(BACKDROP_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* pageChoice keeps the choice for this page when browser storage is unavailable. */
  }
}

/** Test hook: forget this page's choice. */
export function resetBackdropChoice(): void {
  pageChoice = undefined;
}
