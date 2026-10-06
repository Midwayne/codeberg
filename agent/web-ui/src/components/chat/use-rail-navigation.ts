import { type useMessageRail } from './use-message-rail';

import { useCallback, type WheelEvent } from 'react';

import { MESSAGE_ID_ATTR, nearestMarkerId, type MarkerLayout } from '../../lib/message-rail';

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function flashMessage(el: HTMLElement): void {
  el.classList.remove('message-flash');
  // Force a reflow so re-clicking the same tick replays the highlight.
  void el.offsetWidth;
  el.classList.add('message-flash');
}

export type RailNavigationOptions = Pick<Parameters<typeof useMessageRail>[0], 'scrollRef' | 'onNavigate'> & {
  railRef: React.RefObject<HTMLElement | null>;
  laid: MarkerLayout[];
};

export function useRailNavigation({ scrollRef, onNavigate, railRef, laid }: RailNavigationOptions) {
  const jumpTo = useCallback(
    (id: string) => {
      const root = scrollRef.current;
      if (!root) return;
      const el = root.querySelector(`[${MESSAGE_ID_ATTR}="${CSS.escape(id)}"]`);
      if (!(el instanceof HTMLElement)) return;
      onNavigate?.();
      el.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
      flashMessage(el);
    },
    [scrollRef, onNavigate],
  );

  const forwardWheel = (e: WheelEvent<HTMLElement>) => {
    const root = scrollRef.current;
    if (!root) return;
    root.scrollBy({ top: e.deltaY, left: e.deltaX });
  };

  const previewAt = (clientY: number): string | null => {
    const rail = railRef.current;
    if (!rail) return null;
    return nearestMarkerId(laid, clientY - rail.getBoundingClientRect().top);
  };

  return { previewAt, jumpTo, forwardWheel };
}
