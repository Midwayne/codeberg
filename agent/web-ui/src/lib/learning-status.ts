import { startPoll } from './poll';

const POLL_MS = 2000;

export function startLearningStatusPolling(onBusy: (busy: boolean) => void, fetcher: typeof fetch = fetch): () => void {
  const poll = startPoll({
    load: (signal) => loadLearningActivity(fetcher, signal),
    done: (busy) => {
      onBusy(busy);

      return POLL_MS;
    },
    fail: () => {
      // A stale successful response is not evidence that work is still running.
      onBusy(false);

      return POLL_MS;
    },
    timeoutMs: 5000,
  });

  return () => {
    poll.stop();
    onBusy(false);
  };
}

async function loadLearningActivity(fetcher: typeof fetch, signal: AbortSignal): Promise<boolean> {
  const response = await fetcher('/api/learning/status?view=activity', {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error('learning status unavailable');
  const value = (await response.json()) as { working?: unknown };
  if (typeof value.working === 'boolean') return value.working;
  throw new Error('invalid learning status');
}
