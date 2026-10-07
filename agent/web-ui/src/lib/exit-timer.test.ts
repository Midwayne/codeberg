import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExitTimer } from './exit-timer';

afterEach(() => vi.useRealTimers());

describe('retaining an exiting surface', () => {
  it('keeps content until the exit finishes', () => {
    vi.useFakeTimers();

    const timer = new ExitTimer();
    const remove = vi.fn();

    timer.wait(180, remove);
    vi.advanceTimersByTime(179);
    expect(remove).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('does not remove a surface that reopened during its exit', () => {
    vi.useFakeTimers();

    const timer = new ExitTimer();
    const remove = vi.fn();

    timer.wait(180, remove);
    vi.advanceTimersByTime(60);
    timer.cancel();
    vi.runAllTimers();

    expect(remove).not.toHaveBeenCalled();
  });

  it('replaces an interrupted exit and closes keyboard surfaces immediately', () => {
    vi.useFakeTimers();

    const timer = new ExitTimer();
    const stale = vi.fn();
    const remove = vi.fn();

    timer.wait(180, stale);
    timer.wait(0, remove);

    expect(remove).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(stale).not.toHaveBeenCalled();
  });
});
