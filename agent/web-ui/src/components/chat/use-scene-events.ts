import { useEffect, useRef } from 'react';

import { emitSceneEvent, sceneEventFor } from '../../lib/scene/scene-events';

type ChatStatus = Parameters<typeof sceneEventFor>[0];

/** Tells the theme's scene when this chat sends a message, finishes a reply, or fails one. */
export function useSceneEvents(status: ChatStatus): void {
  const previous = useRef(status);

  useEffect(() => {
    const event = sceneEventFor(previous.current, status);
    previous.current = status;

    if (event) emitSceneEvent(event);
  }, [status]);
}
