import { type useMessageRail } from './use-message-rail';
import { useCallback, useEffect, useLayoutEffect, useMemo } from 'react';

import {
  activeMarkerId,
  layoutMarkers,
  MESSAGE_ID_ATTR,
  type ContentMarker,
  type UserMarker,
} from '../../lib/message-rail';

export function offsetTopIn(scroll: HTMLElement, el: HTMLElement): number {
  const s = scroll.getBoundingClientRect();
  const e = el.getBoundingClientRect();
  return e.top - s.top + scroll.scrollTop;
}

export type RailLayoutOptions = Pick<Parameters<typeof useMessageRail>[0], 'scrollRef' | 'messages'> & {
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>;
  markersRef: React.RefObject<ContentMarker[]>;
  railRef: React.RefObject<HTMLElement | null>;
  setTrackHeight: React.Dispatch<React.SetStateAction<number>>;
  users: UserMarker[];
  setContentMarkers: React.Dispatch<React.SetStateAction<(ContentMarker & { fraction: number })[]>>;
  contentMarkers: (ContentMarker & { fraction: number })[];
  trackHeight: number;
};

export function useRailLayout({
  scrollRef,
  setActiveId,
  markersRef,
  railRef,
  setTrackHeight,
  users,
  setContentMarkers,
  messages,
  contentMarkers,
  trackHeight,
}: RailLayoutOptions) {
  const { syncActive } = useActiveRailMarker({ scrollRef, setActiveId, markersRef });

  const measure = useCallback(() => {
    const root = scrollRef.current;
    const rail = railRef.current;
    if (!root) return;
    if (rail) setTrackHeight(rail.clientHeight);

    const contentH = Math.max(root.scrollHeight, 1);
    const next = users.map((u, i) => {
      const el = root.querySelector(`[${MESSAGE_ID_ATTR}="${CSS.escape(u.id)}"]`);
      if (el instanceof HTMLElement) {
        const top = offsetTopIn(root, el);
        return { id: u.id, topInContent: top, fraction: top / contentH };
      }
      const denom = Math.max(users.length - 1, 1);
      return { id: u.id, topInContent: 0, fraction: i / denom };
    });
    markersRef.current = next;
    setContentMarkers(next);
    syncActive();
  }, [scrollRef, users, syncActive]);
  useRailObservers({ measure, messages, scrollRef, railRef, syncActive });

  const laid = useMemo(
    () =>
      layoutMarkers(
        contentMarkers.map((m) => ({ id: m.id, fraction: m.fraction })),
        trackHeight,
      ),
    [contentMarkers, trackHeight],
  );

  return { laid };
}

export type ActiveRailMarkerOptions = Pick<
  Parameters<typeof useRailLayout>[0],
  'scrollRef' | 'setActiveId' | 'markersRef'
>;

export function useActiveRailMarker({ scrollRef, setActiveId, markersRef }: ActiveRailMarkerOptions) {
  const syncActive = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    setActiveId(activeMarkerId(markersRef.current, root.scrollTop, root.clientHeight, root.scrollHeight));
  }, [scrollRef]);

  return { syncActive };
}

export type RailObserversOptions = Pick<Parameters<typeof useRailLayout>[0], 'messages' | 'scrollRef' | 'railRef'> & {
  measure: () => void;
  syncActive: () => void;
};

export function useRailObservers({ measure, messages, scrollRef, railRef, syncActive }: RailObserversOptions) {
  useLayoutEffect(() => {
    measure();
  }, [measure, messages]);

  useEffect(() => {
    const root = scrollRef.current;
    const rail = railRef.current;
    if (!root) return;

    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    if (root.firstElementChild) ro.observe(root.firstElementChild);
    if (rail) ro.observe(rail);

    root.addEventListener('scroll', syncActive, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      root.removeEventListener('scroll', syncActive);
      window.removeEventListener('resize', measure);
    };
  }, [measure, scrollRef, syncActive]);
}
