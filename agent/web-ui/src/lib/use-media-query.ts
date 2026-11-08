import { useCallback, useMemo, useSyncExternalStore } from 'react';

/** Keep responsive behavior in sync with CSS, including viewport changes. */
export type MediaQueryOptions = string;

/** Shared with the workspace skeleton in loading.css. */
export const DESKTOP_LAYOUT_QUERY = '(min-width: 768px)';

export function useDesktopLayout(): boolean {
  return useMediaQuery(DESKTOP_LAYOUT_QUERY);
}

export function useMediaQuery(query: MediaQueryOptions): boolean {
  const media = useMemo(() => (typeof window === 'undefined' ? undefined : window.matchMedia(query)), [query]);
  const subscribe = useCallback(
    (notify: () => void) => {
      media?.addEventListener('change', notify);
      return () => media?.removeEventListener('change', notify);
    },
    [media],
  );
  return useSyncExternalStore(
    subscribe,
    () => media?.matches ?? false,
    () => false,
  );
}
