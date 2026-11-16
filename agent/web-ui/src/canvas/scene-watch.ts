import { useEffect } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

import { pollScene } from './scene-poll';
import type { CanvasSync } from './sync';

type Poll = { close(): void };

/** Watches the scene for agent edits, only while someone can see the canvas. */
export class SceneWatch {
  private poll?: Poll;
  private stopped = false;

  constructor(private readonly open: () => Poll, private readonly pageVisible: () => boolean) {}

  update(): void {
    const live = !this.stopped && this.pageVisible();

    if (live && !this.poll) this.poll = this.open();

    if (!live && this.poll) {
      this.poll.close();
      this.poll = undefined;
    }
  }

  stop(): void {
    this.stopped = true;
    this.update();
  }
}

export function useSceneWatch(api: ExcalidrawImperativeAPI | undefined, sync: CanvasSync,
  fetcher: typeof fetch, status: (value: string) => void) {
  useEffect(() => {
    if (!api) return;

    // Resuming fetches the current scene first, so a background tab catches up.
    const open = () => pollScene(fetcher, { scene: (scene) => sync.receive(scene), status });
    const watch = new SceneWatch(open, () => document.visibilityState !== 'hidden');
    const update = () => watch.update();
    update();

    const warn = (event: BeforeUnloadEvent) => {
      if (sync.local) event.preventDefault();
    };
    document.addEventListener('visibilitychange', update);
    window.addEventListener('beforeunload', warn);

    return () => {
      watch.stop();
      sync.stop();
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('beforeunload', warn);
    };
  }, [api, sync, fetcher, status]);
}
