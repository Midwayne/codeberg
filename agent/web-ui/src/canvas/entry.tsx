import { LoadingSuspense } from '../components/loading-suspense';
import { lazy } from 'react';
import { CanvasBoundary } from './boundary';
import { listenForPreviewVisibility } from './preview-visibility';
import './motion.css';

(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/';
listenForPreviewVisibility();
const Editor = lazy(() => import('./editor'));

export function CanvasPage() {
  return (
    <CanvasBoundary>
      <LoadingSuspense label="Loading local canvas…" kind="canvas" className="h-dvh bg-background text-foreground">
        <Editor />
      </LoadingSuspense>
    </CanvasBoundary>
  );
}
