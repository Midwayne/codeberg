import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { modelLiveness } from './liveness.js';
import { modelTimeout } from './model-timeout.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const liveness = { requestMs: 600_000, idleMs: 300_000, retries: 2 };

it.each(['generate', 'stream'] as const)('retries a %s request that never responds, then fails, with no turn-wide deadline', async (mode) => {
  const signals: AbortSignal[] = [];
  const pending = ({ abortSignal }: { abortSignal?: AbortSignal }) => {
    signals.push(abortSignal!);

    return new Promise<never>(() => undefined);
  };
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const model = modelTimeout(new MockLanguageModelV4({ doGenerate: pending, doStream: pending }), liveness);
  const result = mode === 'generate' ? model.doGenerate({ prompt: [] }) : model.doStream({ prompt: [] });
  const rejected = expect(result).rejects.toThrow('timed out');

  // Two minutes, the old step deadline, is nothing to a live request.
  await vi.advanceTimersByTimeAsync(120_000);
  expect(signals).toHaveLength(1);
  expect(signals[0]!.aborted).toBe(false);

  await vi.advanceTimersByTimeAsync(3 * 600_000 + 60_000);
  await rejected;

  expect(signals).toHaveLength(3);
  expect(signals.every((signal) => signal.aborted)).toBe(true);

  // Each retry is logged with the model and attempt, so a long silent wait is visible.
  expect(warn).toHaveBeenCalledTimes(2);
  expect(String(warn.mock.calls[0]![0])).toMatch(/mock-provider:mock-model-id.*no response in 600s.*retry 1 of 2/);
  expect(vi.getTimerCount()).toBe(0);
});

it('succeeds when a retry answers after the first request stalled', async () => {
  let calls = 0;
  const model = modelTimeout(new MockLanguageModelV4({ doGenerate: async () => {
    if (++calls === 1) return new Promise<never>(() => undefined);

    return { content: [{ type: 'text', text: 'done' }], finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [] };
  } }), liveness);
  const result = model.doGenerate({ prompt: [] });

  await vi.advanceTimersByTimeAsync(600_000 + 60_000);

  expect((await result).content).toEqual([{ type: 'text', text: 'done' }]);
  expect(calls).toBe(2);
});

it('never cuts off a stream that keeps producing output, however long it runs', async () => {
  let pushed = 0;
  const model = modelTimeout(new MockLanguageModelV4({ doStream: async () => ({
    stream: new ReadableStream({ async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      controller.enqueue({ type: 'text-delta', id: 't', delta: '.' });
      if (++pushed === 60) controller.close();
    } }),
  }) }), liveness);
  const opened = model.doStream({ prompt: [] });

  const read = (async () => {
    const reader = (await opened).stream.getReader();
    let chunks = 0;
    while (!(await reader.read()).done) chunks++;

    return chunks;
  })();
  await vi.advanceTimersByTimeAsync(61 * 60_000);

  expect(await read).toBe(60);
  expect(vi.getTimerCount()).toBe(0);
});

it('fails a stream that goes quiet for the idle window and cancels the upstream reader', async () => {
  const cancel = vi.fn();
  const model = modelTimeout(new MockLanguageModelV4({ doStream: async () => ({
    stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'text-start', id: 'answer' });
    }, cancel }),
  }) }), liveness);
  const { stream } = await model.doStream({ prompt: [] });
  const reader = stream.getReader();
  await reader.read();
  const rejected = expect(reader.read()).rejects.toThrow('timed out');

  await vi.advanceTimersByTimeAsync(299_000);
  expect(cancel).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1_000);
  await rejected;

  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('reads liveness from the environment, with defaults like other agent harnesses', () => {
  expect(modelLiveness({})).toEqual({ requestMs: 600_000, idleMs: 300_000, retries: 3 });
  expect(modelLiveness({ CODEBERG_MODEL_REQUEST_TIMEOUT_MS: '900000', CODEBERG_MODEL_IDLE_TIMEOUT_MS: '60000', CODEBERG_MODEL_TIMEOUT_RETRIES: '0' }))
    .toEqual({ requestMs: 900_000, idleMs: 60_000, retries: 0 });
  expect(modelLiveness({ CODEBERG_MODEL_REQUEST_TIMEOUT_MS: 'soon', CODEBERG_MODEL_IDLE_TIMEOUT_MS: '-5' }))
    .toEqual({ requestMs: 600_000, idleMs: 300_000, retries: 3 });
});

it('releases every provider timer after EOF so a subsequent browser task can wait', async () => {
  let signal: AbortSignal | undefined;
  const model = modelTimeout(new MockLanguageModelV4({ doStream: async ({ abortSignal }) => {
    signal = abortSignal;

    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'tool-call', toolCallId: 'browser', toolName: 'browser_task', input: '{}' });
      controller.close();
    } }) };
  } }));
  const reader = (await model.doStream({ prompt: [] })).stream.getReader();
  expect((await reader.read()).done).toBe(false);
  expect((await reader.read()).done).toBe(true);

  await vi.advanceTimersByTimeAsync(60 * 60_000);

  expect(signal?.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('propagates explicit cancellation to the provider and closes its stream', async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  let signal: AbortSignal | undefined;
  const model = modelTimeout(new MockLanguageModelV4({ doStream: async ({ abortSignal }) => {
    signal = abortSignal;

    return { stream: new ReadableStream({ cancel }) };
  } }));
  // The request has opened but produced nothing yet when the user stops it.
  const rejected = expect(model.doStream({ prompt: [], abortSignal: controller.signal })).rejects.toThrow('User stopped');

  await vi.advanceTimersByTimeAsync(1_000);
  controller.abort(new Error('User stopped'));
  await rejected;

  expect(signal?.aborted).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('cleans up after the caller cancels consumption or a provider throws', async () => {
  const cancel = vi.fn();
  const model = modelTimeout(new MockLanguageModelV4({
    doStream: async () => ({ stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'text-start', id: 't' });
    }, cancel }) }),
    doGenerate: async () => { throw new Error('Provider failed'); },
  }));

  await (await model.doStream({ prompt: [] })).stream.cancel();
  expect(cancel).toHaveBeenCalledOnce();
  await expect(model.doGenerate({ prompt: [] })).rejects.toThrow('Provider failed');
  expect(vi.getTimerCount()).toBe(0);
});

it('does not start provider work with an already aborted request', async () => {
  const controller = new AbortController();
  controller.abort(new Error('Already stopped'));
  const generate = vi.fn();
  const model = modelTimeout(new MockLanguageModelV4({ doGenerate: generate }));

  await expect(model.doGenerate({ prompt: [], abortSignal: controller.signal })).rejects.toThrow('Already stopped');
  expect(generate).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('never retries a request the user stopped', async () => {
  const controller = new AbortController();
  const generate = vi.fn(({ abortSignal }: { abortSignal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
    abortSignal!.addEventListener('abort', () => reject(abortSignal!.reason));
  }));
  const model = modelTimeout(new MockLanguageModelV4({ doGenerate: generate }), liveness);
  const result = expect(model.doGenerate({ prompt: [], abortSignal: controller.signal })).rejects.toThrow('User stopped');

  await vi.advanceTimersByTimeAsync(1_000);
  controller.abort(new Error('User stopped'));
  await result;
  await vi.advanceTimersByTimeAsync(10 * 600_000);

  expect(generate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('retries a stream that opened but never produced output', async () => {
  let calls = 0;
  const model = modelTimeout(new MockLanguageModelV4({ doStream: async () => {
    calls++;

    return { stream: new ReadableStream({ start(controller) {
      if (calls === 1) return;

      controller.enqueue({ type: 'text-delta', id: 't', delta: 'answer' });
      controller.close();
    } }) };
  } }), liveness);
  const opened = model.doStream({ prompt: [] });

  await vi.advanceTimersByTimeAsync(600_000 + 60_000);
  const reader = (await opened).stream.getReader();

  expect(await reader.read()).toEqual({ done: false, value: { type: 'text-delta', id: 't', delta: 'answer' } });
  expect((await reader.read()).done).toBe(true);
  expect(calls).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
});
