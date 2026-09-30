import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLearningStatusPolling } from './learning-status';

const stops: Array<() => void> = [];
afterEach(() => { stops.splice(0).forEach((stop) => stop()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('learning activity polling', () => {
  it('clears a previous busy state when polling fails instead of leaving the banner stuck', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ active: 1 })))
      .mockRejectedValueOnce(new Error('network unavailable'));
    vi.stubGlobal('fetch', fetch);
    const busy = vi.fn();
    stops.push(startLearningStatusPolling(busy));
    await vi.advanceTimersByTimeAsync(0);
    expect(busy).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(busy).toHaveBeenLastCalledWith(false);
  });

  it('does not overlap slow requests or let an old busy response override idle', async () => {
    vi.useFakeTimers();
    let resolve: ((value: Response) => void) | undefined;
    const fetch = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetch);
    stops.push(startLearningStatusPolling(vi.fn()));
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve?.(new Response(JSON.stringify({ active: 0 })));
    await vi.advanceTimersByTimeAsync(0);
  });

  it('times out a hung poll and clears stale busy state', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ working: true })))
      .mockImplementationOnce(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', fetch);
    const busy = vi.fn();
    stops.push(startLearningStatusPolling(busy));
    await vi.advanceTimersByTimeAsync(0);
    expect(busy).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(7000);
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(fetch.mock.calls[1]?.[1]?.signal.aborted).toBe(true);
  });

  it('uses actual execution state even when eligible or orphaned jobs remain queued', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ active: 5, working: false }))));
    const busy = vi.fn();
    stops.push(startLearningStatusPolling(busy));
    await vi.advanceTimersByTimeAsync(0);
    expect(busy).toHaveBeenLastCalledWith(false);
  });

  it('clears busy state on non-success and malformed responses, and ignores late replies after cleanup', async () => {
    vi.useFakeTimers();
    let resolve: ((value: Response) => void) | undefined;
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ working: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: 1 }), { status: 503 }))
      .mockResolvedValueOnce(new Response('not json'))
      .mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetch);
    const busy = vi.fn();
    const stop = startLearningStatusPolling(busy);
    stops.push(stop);
    await vi.advanceTimersByTimeAsync(2000);
    expect(busy).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(busy).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(2000);
    stop();
    resolve?.(new Response(JSON.stringify({ working: true })));
    await vi.advanceTimersByTimeAsync(0);
    expect(busy).toHaveBeenLastCalledWith(false);
  });
});
