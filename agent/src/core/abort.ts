/**
 * Run `handler` once when `signal` aborts, or right away if it already has
 * (an aborted signal never fires 'abort' again). Returns a function that
 * removes the listener.
 */
export function onAbort(signal: AbortSignal | undefined, handler: () => void): () => void {
  if (!signal) return () => undefined;

  if (signal.aborted) {
    handler();

    return () => undefined;
  }

  signal.addEventListener('abort', handler, { once: true });

  return () => signal.removeEventListener('abort', handler);
}
