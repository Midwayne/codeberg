/** Cancels stale removal when an exiting surface is reopened or unmounted. */
export class ExitTimer {
  private timer?: ReturnType<typeof setTimeout>;

  wait(duration: number, finish: () => void): void {
    this.cancel();

    if (duration === 0) {
      finish();
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      finish();
    }, duration);
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
