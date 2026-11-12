import { useEffect } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

import { canvasProject } from './api';
import { onPreviewVisibility, previewShown } from './preview-visibility';
import type { CanvasSync } from './sync';

/** Holds one canvas event stream, only while someone can see the canvas. */
export class CanvasEvents {
  private source?: EventSource;
  private shown = true;
  private stopped = false;

  constructor(private readonly open: () => EventSource, private readonly pageVisible: () => boolean) {}

  show(visible: boolean): void {
    this.shown = visible;
    this.update();
  }

  update(): void {
    const live = !this.stopped && this.shown && this.pageVisible();

    if (live && !this.source) this.source = this.open();

    if (!live && this.source) {
      this.source.close();
      this.source = undefined;
    }
  }

  stop(): void {
    this.stopped = true;
    this.update();
  }
}

function openEvents(sync: CanvasSync, status: (value: string) => void): EventSource {
  const url = new URL('/api/canvas/events', location.origin);
  url.searchParams.set('chat', new URL(location.href).searchParams.get('chat') ?? '');

  const project = canvasProject();
  if (project) url.searchParams.set('project', project);

  const events = new EventSource(url);
  events.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.scene) sync.receive(message.scene);
      else if (message.scene === null) status('Waiting for the agent’s drawing…');
      else if (message.error) status(message.error);
    } catch {
      status('Invalid canvas update. Reload to reconnect.');
    }
  };
  events.onerror = () => status('Canvas disconnected. Reconnecting; unsaved changes are kept here.');

  return events;
}

export function useCanvasEvents(api: ExcalidrawImperativeAPI | undefined, sync: CanvasSync, status: (value: string) => void) {
  useEffect(() => {
    if (!api) return;

    // Reconnecting replays the current scene, so paused previews catch up.
    const events = new CanvasEvents(() => openEvents(sync, status), () => document.visibilityState !== 'hidden');
    const update = () => events.show(previewShown());
    const unsubscribe = onPreviewVisibility(update);
    update();

    const warn = (event: BeforeUnloadEvent) => {
      if (sync.local) event.preventDefault();
    };
    document.addEventListener('visibilitychange', update);
    window.addEventListener('beforeunload', warn);

    return () => {
      events.stop();
      sync.stop();
      unsubscribe();
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('beforeunload', warn);
    };
  }, [api, sync, status]);
}
