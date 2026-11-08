import type { RefObject } from 'react';

export const AUTO_SCROLL_HOLD_MS = 700;

export function pauseAutoScroll(hold: RefObject<boolean>, timer: RefObject<number>): void {
  hold.current = true;
  window.clearTimeout(timer.current);

  timer.current = window.setTimeout(() => {
    hold.current = false;
  }, AUTO_SCROLL_HOLD_MS);
}
