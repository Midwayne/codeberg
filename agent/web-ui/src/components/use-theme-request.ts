import { useEffect, useRef, useState } from 'react';

/** One cancellable model request at a time, with its pending and error state. */
export function useThemeRequest() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef<AbortController | null>(null);

  // Leaving Settings stops a request nobody is waiting for.
  useEffect(() => () => request.current?.abort(), []);

  async function run(task: (signal: AbortSignal) => Promise<void>) {
    const abort = new AbortController();
    request.current = abort;
    setPending(true);
    setError(undefined);

    try {
      await task(abort.signal);
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not create a theme.');
    } finally {
      if (request.current === abort) request.current = null;

      setPending(false);
    }
  }

  return { pending, error, setError, run, cancel: () => request.current?.abort() };
}
