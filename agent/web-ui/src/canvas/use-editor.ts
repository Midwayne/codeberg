import { restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Scene } from '@agent/core/canvas/types';
import { canvasEmbedded, canvasFetch, canvasProject } from './api';
import { CanvasSync } from './sync';
import { sceneFingerprint } from './merge';

export function useEditor() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI>();
  const [scene, setScene] = useState<Scene>();
  const [status, setStatus] = useState('Connecting to local canvas…');
  const [conflict, setConflict] = useState(false);
  const applied = useRef('');
  const fetch = useMemo(canvasFetch, []);
  const sync = useMemo(() => new CanvasSync({ fetch, status: setStatus, conflict: setConflict,
    apply: (next) => {
      const elements = restoreElements(next.elements as unknown as ExcalidrawElement[], null);
      applied.current = sceneFingerprint({ ...next, elements: elements as unknown as Scene['elements'] });
      if (api) {
        api.addFiles(Object.values(next.files) as BinaryFiles[string][]);
        api.updateScene({ elements, appState: { ...api.getAppState(), ...next.appState } });
        if (canvasEmbedded() || api.getAppState().name !== next.name) {
          api.updateScene({ appState: { ...api.getAppState(), name: next.name } });
          api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.8 });
        }
      }
      setScene(next);
    },
  }), [api, fetch]);
  useCanvasEvents(api, sync, setStatus);
  usePreviewFit(api);

  const onChange = (elements: readonly ExcalidrawElement[], state: AppState, files: BinaryFiles) => {
    if (canvasEmbedded() || !sync.base) return;

    const appState = { viewBackgroundColor: state.viewBackgroundColor, gridSize: state.gridSize,
      gridStep: state.gridStep, gridModeEnabled: state.gridModeEnabled };
    const next = { ...sync.base, elements: elements as unknown as Scene['elements'], appState, files };
    if (sceneFingerprint(next) === applied.current) return;

    sync.stage(next.elements, appState, files);
  };
  return { api, setApi, scene, status, conflict, sync, fetch, onChange };
}

function useCanvasEvents(api: ExcalidrawImperativeAPI | undefined, sync: CanvasSync, status: (value: string) => void) {
  useEffect(() => {
    if (!api) return;

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
    const warn = (event: BeforeUnloadEvent) => {
      if (sync.local) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      events.close();
      sync.stop();
      window.removeEventListener('beforeunload', warn);
    };
  }, [api, sync, status]);
}

function usePreviewFit(api: ExcalidrawImperativeAPI | undefined): void {
  useEffect(() => {
    const container = document.querySelector('.canvas-preview');
    if (!api || !canvasEmbedded() || !container) return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => api.scrollToContent(api.getSceneElements(), {
        fitToViewport: true, viewportZoomFactor: 0.8,
      }));
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [api]);
}
