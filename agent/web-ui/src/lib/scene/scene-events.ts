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

/** A message was sent when a chat starts submitting. */
export function sceneEventFor(previous: ChatStatus, next: ChatStatus): SceneEvent | undefined {
  return next === 'submitted' && previous !== 'submitted' ? 'send' : undefined;
}

type Finish = { isAbort: boolean; isError: boolean; isDisconnect: boolean };

/** How a reply ended: finished, or failed; a reply the user stopped is not an event. */
export function sceneEventForFinish(finish: Finish): SceneEvent | undefined {
  if (finish.isAbort) return undefined;

  return finish.isError || finish.isDisconnect ? 'error' : 'reply';
}
