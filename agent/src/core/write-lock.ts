/** Runs async actions one at a time. A failed action does not block the next one. */
export class WriteLock {
  private pending: Promise<unknown> = Promise.resolve();

  run<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.pending.then(action);

    this.pending = pending.then(
      () => undefined,
      () => undefined,
    );

    return pending;
  }

  /** Resolves when every action started so far has settled. */
  done(): Promise<void> {
    return this.pending.then(() => undefined);
  }
}
