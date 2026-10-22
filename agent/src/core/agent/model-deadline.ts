/** Timers exist only while a provider request or its response stream is active. */
export class ModelDeadline {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly total: ReturnType<typeof setTimeout>;
  private idle?: ReturnType<typeof setTimeout>;

  constructor(parent: AbortSignal | undefined, duration: number, private readonly chunkMs?: number) {
    this.signal = parent ? AbortSignal.any([parent, this.controller.signal]) : this.controller.signal;
    this.signal.throwIfAborted();

    this.total = setTimeout(() => this.expire(), duration);
    this.signal.addEventListener('abort', this.close, { once: true });
  }

  close = () => {
    clearTimeout(this.total);
    clearTimeout(this.idle);
    this.signal.removeEventListener('abort', this.close);
  };

  async wait<T>(pending: PromiseLike<T>): Promise<T> {
    let abort: () => void = () => undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(this.signal.reason);
      if (this.signal.aborted) abort();
      else this.signal.addEventListener('abort', abort, { once: true });
    });

    try {
      return await Promise.race([pending, interrupted]);
    } finally {
      this.signal.removeEventListener('abort', abort);
    }
  }

  stream<T>(source: ReadableStream<T>): ReadableStream<T> {
    const reader = source.getReader();
    let finished = false;
    let abort = () => undefined;
    const finish = () => {
      finished = true;
      this.close();
      this.signal.removeEventListener('abort', abort);
    };

    return new ReadableStream({
      start: (controller) => {
        abort = () => {
          finish();
          controller.error(this.signal.reason);
          void reader.cancel(this.signal.reason).catch(() => undefined);
        };
        this.signal.addEventListener('abort', abort, { once: true });
        if (this.signal.aborted) abort();
      },
      pull: async (controller) => {
        try {
          const next = await reader.read();
          if (finished) return;

          if (next.done) {
            finish();
            controller.close();
          } else {
            this.touch();
            controller.enqueue(next.value);
          }
        } catch (error) {
          if (finished) return;

          finish();
          controller.error(error);
        }
      },
      cancel: (reason) => {
        finish();

        return reader.cancel(reason);
      },
    });
  }

  private touch() {
    if (this.chunkMs === undefined) return;

    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.expire(), this.chunkMs);
  }

  private expire() {
    this.controller.abort(new DOMException('Model request timed out.', 'TimeoutError'));
  }
}
