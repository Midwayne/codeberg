/** Caps how many tasks run at once; the rest wait in arrival order. */
export class Semaphore {
  private running = 0;

  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  /** True while any work holds or waits for a slot. */
  get busy(): boolean {
    return this.running > 0 || this.waiting.length > 0;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();

    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;

      return Promise.resolve();
    }

    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) return next();

    this.running--;
  }
}
