import type { Scene } from '@agent/core/canvas/types';
import { startPoll } from '../lib/poll';

/** How often a visible canvas checks for agent edits. */
const SCENE_POLL_MS = 1000;

type SceneHandlers = {
  scene: (scene: Scene) => void;
  status: (message: string) => void;
};

/**
 * Short conditional polls instead of a held event stream: browsers share six
 * HTTP/1.1 connections per origin across all tabs, and long-lived streams
 * starve chat, model and project requests.
 */
export function pollScene(fetcher: typeof fetch, on: SceneHandlers, interval = SCENE_POLL_MS): { close(): void } {
  let tag = '';

  const poll = startPoll({
    load: (signal) => checkScene(fetcher, on, tag, signal),
    done: (next) => {
      tag = next;

      return interval;
    },
    fail: () => {
      on.status('Canvas disconnected. Reconnecting; unsaved changes are kept here.');

      return interval;
    },
  });

  return { close: () => poll.stop() };
}

async function checkScene(fetcher: typeof fetch, on: SceneHandlers, tag: string, signal: AbortSignal): Promise<string> {
  const response = await fetcher('/api/canvas/scene', {
    signal,
    cache: 'no-store',
    headers: tag ? { 'If-None-Match': tag } : {},
  });

  if (response.status === 304) return tag;

  if (response.ok) {
    on.scene(await response.json() as Scene);

    return response.headers.get('ETag') ?? '';
  }

  if (response.status === 404) on.status('Waiting for the agent’s drawing…');
  else on.status((await response.json().catch(() => ({}))).error ?? 'Canvas unavailable. Retry.');

  return '';
}
