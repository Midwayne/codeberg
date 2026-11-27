import type { SceneEvent } from '../theme-types';

type Listener = (event: SceneEvent) => void;

const listeners = new Set<Listener>();

/** Tells a running scene that something happened in the app. */
export function emitSceneEvent(event: SceneEvent): void {
  for (const listener of listeners) listener(event);
}

export function subscribeSceneEvents(listener: Listener): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

/** The event a chat status change means: a message sent, a reply finished, or a reply failed. */
export function sceneEventFor(previous: ChatStatus, next: ChatStatus): SceneEvent | undefined {
  if (previous === next) return undefined;

  if (next === 'submitted') return 'send';

  const answering = previous === 'submitted' || previous === 'streaming';
  if (!answering) return undefined;

  if (next === 'ready') return 'reply';

  return next === 'error' ? 'error' : undefined;
}
