import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';

import { subscribeSceneEvents } from '../lib/scene/scene-events';
import { sceneWorkerSource } from '../lib/scene/scene-worker';
import type { Palette } from '../lib/theme-types';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(notify: () => void): () => void {
  const query = window.matchMedia?.(REDUCED_MOTION);
  query?.addEventListener('change', notify);

  return () => query?.removeEventListener('change', notify);
}

/** Whether the system asks for reduced motion; scenes then draw one still frame. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia?.(REDUCED_MOTION).matches ?? false, () => false);
}

type Channel = {
  frame: RefObject<HTMLIFrameElement | null>;
  script: string;
  colors: Palette;
  motion: boolean;
  onFail: (reason: string, detail: string) => void;
};

/*
 * Talks to one scene frame: starts it on its first load, forwards app events
 * and tab visibility, and reports a failure. A second load means the frame
 * navigated away from its sandboxed page, so the scene is stopped.
 */
export function useSceneFrame({ frame, script, colors, motion, onFail }: Channel): () => void {
  const loads = useRef(0);
  const post = (message: object) => frame.current?.contentWindow?.postMessage(message, '*');

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; reason?: unknown; detail?: unknown } | null;
      if (event.source !== frame.current?.contentWindow || data?.type !== 'codeberg-scene') return;

      onFail(String(data.reason), String(data.detail ?? ''));
    };
    const onVisibility = () => post({ type: document.hidden ? 'pause' : 'resume' });
    const unsubscribe = subscribeSceneEvents((name) => post({ type: 'event', name }));

    window.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsubscribe();
      window.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });

  return () => {
    loads.current += 1;

    if (loads.current > 1) return onFail('navigated', '');

    // Opaque-origin frames have no origin to target; nothing secret is sent.
    post({ type: 'init', source: sceneWorkerSource(script), colors: { ...colors }, motion });
  };
}
