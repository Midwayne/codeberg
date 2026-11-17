import { restoreElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { useMemo, useRef, useState } from 'react';
import type { Scene } from '@agent/core/canvas/types';
import { canvasFetch } from './api';
import { useSceneWatch } from './scene-watch';
import { CanvasSync } from './sync';
import { sceneFingerprint } from './merge';
import { useSceneMotion } from './use-scene-motion';
import { styleDefaults } from './style-defaults';

export function useEditor() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI>();
  const [scene, setScene] = useState<Scene>();
  const [status, setStatus] = useState('Connecting to local canvas…');
  const [conflict, setConflict] = useState(false);
  const applied = useRef('');
  const motion = useSceneMotion();
  const fetch = useMemo(canvasFetch, []);
  const sync = useMemo(() => new CanvasSync({ fetch, status: setStatus, conflict: setConflict,
    apply: (next, animate) => {
      const elements = restoreElements(next.elements as unknown as ExcalidrawElement[], null);
      applied.current = sceneFingerprint({ ...next, elements: elements as unknown as Scene['elements'] });

      if (api) {
        motion.transition(animate && !browserIsEditing(api.getAppState()));

        api.addFiles(Object.values(next.files) as BinaryFiles[string][]);
        api.updateScene({ elements, appState: { ...api.getAppState(), ...next.appState } });
        if (api.getAppState().name !== next.name) {
          api.updateScene({ appState: { ...api.getAppState(), name: next.name } });
          api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.8 });
        }
      }
      setScene(next);
    },
  }), [api, fetch, motion.transition]);
  useSceneWatch(api, sync, fetch, setStatus);

  const onChange = (elements: readonly ExcalidrawElement[], state: AppState, files: BinaryFiles) => {
    if (!sync.base) return;

    const appState = { viewBackgroundColor: state.viewBackgroundColor, gridSize: state.gridSize,
      gridStep: state.gridStep, gridModeEnabled: state.gridModeEnabled, ...styleDefaults(state, sync.base.appState) };
    const next = { ...sync.base, elements: elements as unknown as Scene['elements'], appState, files };
    if (sceneFingerprint(next) === applied.current) return;

    sync.stage(next.elements, appState, files);
  };
  return { api, setApi, scene, status, conflict, sync, fetch, onChange, motion };
}

function browserIsEditing(state: AppState): boolean {
  return Boolean(state.newElement || state.editingTextElement || state.editingLinearElement ||
    state.selectedElementsAreBeingDragged || state.isResizing || state.isRotating);
}
