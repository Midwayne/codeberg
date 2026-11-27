import { findTheme, setTheme } from './themes';
import type { ThemeId } from './theme-palettes';

let origin: { x: number; y: number } | undefined;

/* Counts transitions so an interrupted one cannot clear the newer one's effect. */
let latestTransition = 0;

/** Remembers where the user last pressed, so a reveal grows from the click. */
export function trackThemeOrigin(): () => void {
  const remember = (event: PointerEvent) => {
    origin = { x: event.clientX, y: event.clientY };
  };

  // A keyboard choice has no click point, so its reveal grows from the center.
  const forget = () => {
    origin = undefined;
  };

  window.addEventListener('pointerdown', remember, { capture: true, passive: true });
  window.addEventListener('keydown', forget, { capture: true, passive: true });

  return () => {
    window.removeEventListener('pointerdown', remember, { capture: true });
    window.removeEventListener('keydown', forget, { capture: true });
  };
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Sets where the reveal circle starts and how far it must grow to cover the window. */
function placeReveal(root: HTMLElement): void {
  const { innerWidth: width, innerHeight: height } = window;
  const { x, y } = origin ?? { x: width / 2, y: height / 2 };
  const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));

  root.style.setProperty('--reveal-x', `${x}px`);
  root.style.setProperty('--reveal-y', `${y}px`);
  root.style.setProperty('--reveal-r', `${Math.ceil(radius)}px`);
}

/**
 * Applies and saves a theme with its transition: a circle from the click, a
 * crossfade, a top-to-bottom scan, or a blur dissolve. Browsers without view
 * transitions fade colors instead; reduced motion switches instantly.
 */
export function changeTheme(id: ThemeId, onApplied?: () => void): void {
  const apply = () => {
    setTheme(id);
    onApplied?.();
  };

  if (reducedMotion()) return apply();

  const root = document.documentElement;
  if (typeof document.startViewTransition !== 'function') return fadeColors(root, apply);

  root.dataset.themeTransition = findTheme(id).transition ?? 'reveal';
  placeReveal(root);

  const current = ++latestTransition;
  const transition = document.startViewTransition(apply);

  void transition.finished.finally(() => {
    if (current === latestTransition) delete root.dataset.themeTransition;
  });
}

let fadeTimer: number | undefined;

/* A quick second change restarts the fade instead of having the first one end it. */
function fadeColors(root: HTMLElement, apply: () => void): void {
  if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);

  root.classList.add('theme-fading');
  apply();

  fadeTimer = window.setTimeout(() => {
    root.classList.remove('theme-fading');
    fadeTimer = undefined;
  }, 450);
}
