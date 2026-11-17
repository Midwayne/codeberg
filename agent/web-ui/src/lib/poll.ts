type PollOptions<T> = {
  /** One request; `signal` aborts when the poll stops or the attempt times out. */
  load: (signal: AbortSignal) => Promise<T>;
  /** Handles a result and returns the delay before the next attempt, or undefined to pause. */
  done: (value: T) => number | undefined;
  /** Handles a failure (including a timeout) the same way. */
  fail: (error: unknown) => number | undefined;
  /** Gives up on an attempt that has not settled after this long. */
  timeoutMs?: number;
  /** Load at once (default), or wait for the first `wake()`. */
  start?: boolean;
};

export type Poll = {
  stop(): void;
  /** Loads now unless an attempt is already running; restarts a paused poll. */
  wake(): void;
};

/**
 * Repeats one request at a time. Results and failures that arrive after
 * `stop()` are dropped, so a late reply cannot overwrite newer state.
 */
export function startPoll<T>(options: PollOptions<T>): Poll {
  const stopped = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;

  const schedule = (delay: number | undefined) => {
    if (delay !== undefined && !stopped.signal.aborted) timer = setTimeout(() => void attempt(), delay);
  };

  const attempt = async () => {
    if (running || stopped.signal.aborted) return;

    clearTimeout(timer);
    running = true;
    const attemptController = new AbortController();
    const signal = AbortSignal.any([stopped.signal, attemptController.signal]);

    try {
      const value = await withTimeout(options.load(signal), attemptController, options.timeoutMs);
      if (!stopped.signal.aborted) schedule(options.done(value));
    } catch (error) {
      if (!stopped.signal.aborted) schedule(options.fail(error));
    } finally {
      running = false;
    }
  };

  if (options.start !== false) void attempt();

  return {
    stop() {
      stopped.abort();
      clearTimeout(timer);
    },
    wake() {
      void attempt();
    },
  };
}

/** Rejects after `timeoutMs` even when the request ignores its abort signal. */
function withTimeout<T>(request: Promise<T>, controller: AbortController, timeoutMs?: number): Promise<T> {
  if (timeoutMs === undefined) return request;

  let deadline: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => {
      controller.abort();
      reject(new Error('Request timed out'));
    }, timeoutMs);
  });

  return Promise.race([request, timeout]).finally(() => clearTimeout(deadline));
}
