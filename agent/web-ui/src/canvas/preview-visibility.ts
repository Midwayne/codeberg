export const PREVIEW_VISIBILITY = 'codeberg:canvas-preview-visibility';

type VisibilityMessage = { type?: unknown; visible?: unknown } | null;

let shown = true;
const listeners = new Set<() => void>();

/** Whether the embedding chat currently shows this canvas preview. */
export function previewShown(): boolean {
  return shown;
}

export function onPreviewVisibility(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function receivePreviewVisibility(event: MessageEvent): void {
  if (event.origin !== location.origin || event.source !== window.parent) return;

  const data = event.data as VisibilityMessage;
  if (data?.type !== PREVIEW_VISIBILITY || typeof data.visible !== 'boolean') return;

  shown = data.visible;
  for (const listener of listeners) listener();
}

/** Install before the editor loads so a preview hidden early is never missed. */
export function listenForPreviewVisibility(): void {
  if (window.parent === window) return;

  window.addEventListener('message', receivePreviewVisibility);
}

export function postPreviewVisibility(frame: HTMLIFrameElement | null, visible: boolean): void {
  frame?.contentWindow?.postMessage({ type: PREVIEW_VISIBILITY, visible }, location.origin);
}
