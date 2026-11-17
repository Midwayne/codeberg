import { afterEach, describe, expect, it, vi } from 'vitest';

import { startPoll } from './poll';

afterEach(() => {
  vi.useRealTimers();
});

describe('startPoll', () => {
  it('repeats after the delay the result handler returns', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => 'ok');
    const poll = startPoll({ load, done: () => 100, fail: () => 100 });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    expect(load).toHaveBeenCalledTimes(2);
    poll.stop();
  });

  it('drops a result that arrives after stop', async () => {
    vi.useFakeTimers();
    let resolve: ((value: string) => void) | undefined;
    const done = vi.fn(() => 100);
    const poll = startPoll({ load: () => new Promise<string>((ready) => { resolve = ready; }), done, fail: () => 100 });

    poll.stop();
    resolve?.('late');
    await vi.advanceTimersByTimeAsync(0);

    expect(done).not.toHaveBeenCalled();
  });

  it('fails an attempt that ignores its signal past the timeout', async () => {
    vi.useFakeTimers();
    const fail = vi.fn(() => undefined);
    startPoll({ load: () => new Promise<string>(() => undefined), done: () => 100, fail, timeoutMs: 50 });

    await vi.advanceTimersByTimeAsync(50);

    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ message: 'Request timed out' }));
  });

  it('pauses on undefined and resumes on wake, never overlapping attempts', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => 'ok');
    const poll = startPoll({ load, done: () => undefined, fail: () => undefined, start: false });

    expect(load).not.toHaveBeenCalled();

    poll.wake();
    poll.wake();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(load).toHaveBeenCalledTimes(1);
    poll.stop();
  });
});
