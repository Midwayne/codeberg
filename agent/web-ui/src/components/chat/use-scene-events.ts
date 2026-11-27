import { useEffect, useRef } from 'react';

import { emitSceneEvent, sceneEventFor } from '../../lib/scene/scene-events';

type ChatStatus = Parameters<typeof sceneEventFor>[0];

/*
 * Tells the theme's scene when this chat sends a message; replies are reported
 * when they finish (workspace-chat.ts). A hidden chat view keeps its refs but
 * runs its effects again when shown, so the first run after that only catches
 * up instead of reporting a send that happened while it was hidden.
 */
export function useSceneEvents(status: ChatStatus): void {
  const previous = useRef(status);
  const shown = useRef(false);

  useEffect(() => () => {
    shown.current = false;
  }, []);

  useEffect(() => {
    const event = shown.current ? sceneEventFor(previous.current, status) : undefined;

    shown.current = true;
    previous.current = status;

    if (event) emitSceneEvent(event);
  }, [status]);
}
