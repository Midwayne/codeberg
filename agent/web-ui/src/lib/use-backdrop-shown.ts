import { useSyncExternalStore } from 'react';

function subscribe(notify: () => void): () => void {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-backdrop'] });

  return () => observer.disconnect();
}

/** Whether a backdrop is on screen; applyBackdrop removes the root's data-backdrop when it is off. */
export function useBackdropShown(): boolean {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.backdrop !== undefined, () => false);
}
