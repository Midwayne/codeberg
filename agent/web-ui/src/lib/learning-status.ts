/** Shared polling lifecycle for the header's learning indicator. */
export function startLearningStatusPolling(onBusy: (busy: boolean) => void, fetcher: typeof fetch = fetch): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  const check = async () => {
    const controller = new AbortController();
    request = controller;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => { controller.abort(); reject(new Error('learning status timed out')); }, 5000);
    });
    try {
      const status = await Promise.race([
        (async () => {
          const response = await fetcher('/api/learning/status?view=activity', { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('learning status unavailable');
          const value = await response.json() as { working?: unknown; active?: unknown };
          if (typeof value.working === 'boolean') return value.working;
          // Compatibility with a web server that has not yet been restarted.
          if (typeof value.active === 'number' && Number.isFinite(value.active)) return value.active > 0;
          throw new Error('invalid learning status');
        })(), timeout,
      ]);
      if (active) onBusy(status);
    } catch {
      // A stale successful response is not evidence that work is still running.
      if (active) onBusy(false);
    } finally {
      if (deadline) clearTimeout(deadline);
      request = undefined;
      if (active) timer = setTimeout(() => void check(), 2000);
    }
  };
  void check();
  return () => { active = false; if (timer) clearTimeout(timer); request?.abort(); onBusy(false); };
}
