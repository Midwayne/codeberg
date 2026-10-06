import { lazy, Suspense } from 'react';
import { CanvasBoundary } from './boundary';

(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/';
const Editor = lazy(() => import('./editor'));

export function CanvasPage() {
  return <CanvasBoundary><Suspense fallback={<p role="status" className="p-6">Loading local canvas…</p>}><Editor /></Suspense></CanvasBoundary>;
}
