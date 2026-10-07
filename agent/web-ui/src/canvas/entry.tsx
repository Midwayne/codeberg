import { lazy, Suspense } from 'react';
import { CanvasBoundary } from './boundary';
import './motion.css';

(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/';
const Editor = lazy(() => import('./editor'));

export function CanvasPage() {
  return <CanvasBoundary><Suspense fallback={
    <div className="relative h-dvh bg-background text-foreground">
      <p role="status" className="canvas-loading p-6 text-xs text-muted-foreground">Loading local canvas…</p>
    </div>
  }><Editor /></Suspense></CanvasBoundary>;
}
