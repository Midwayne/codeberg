/** Keyboard actions stay immediate; pointer actions opt into occasional UI motion. */
export function trackMotionInput(): () => void {
  const keyboard = () => {
    document.documentElement.dataset.uiMotion = 'instant';
  };
  const pointer = () => {
    delete document.documentElement.dataset.uiMotion;
  };

  document.addEventListener('keydown', keyboard, { capture: true });
  document.addEventListener('pointerdown', pointer, { capture: true });

  return () => {
    document.removeEventListener('keydown', keyboard, { capture: true });
    document.removeEventListener('pointerdown', pointer, { capture: true });
  };
}

export function instantMotion(): boolean {
  return typeof document === 'undefined' || document.documentElement.dataset.uiMotion === 'instant';
}

export function exitDuration(duration: number): number {
  if (instantMotion()) return 0;

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : duration;
}
