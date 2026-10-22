import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { modelTimeout } from './model-timeout.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each(['generate', 'stream'] as const)('bounds a stalled %s provider request without relying on run-wide timers', async (mode) => {
  let signal: AbortSignal | undefined;
  const pending = ({ abortSignal }: { abortSignal?: AbortSignal }) => {
    signal = abortSignal;

    return new Promise<never>(() => undefined);
  };
  const model = modelTimeout(new MockLanguageModelV4({ doGenerate: pending, doStream: pending }));
  const result = mode === 'generate' ? model.doGenerate({ prompt: [] }) : model.doStream({ prompt: [] });
  const rejected = expect(result).rejects.toThrow('timed out');

  await vi.advanceTimersByTimeAsync(120_000);
  await rejected;

  expect(signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('times out a stalled response stream and cancels the upstream reader', async () => {
  const cancel = vi.fn();
  const model = modelTimeout(new MockLanguageModelV4({ doStream: async () => ({
    stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'text-start', id: 'answer' });
    }, cancel }),
  }) }));
  const { stream } = await model.doStream({ prompt: [] });
  const reader = stream.getReader();
  await reader.read();
  const rejected = expect(reader.read()).rejects.toThrow('timed out');

  await vi.advanceTimersByTimeAsync(60_000);
  await rejected;

  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
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
  const reader = (await model.doStream({ prompt: [], abortSignal: controller.signal })).stream.getReader();
  const rejected = expect(reader.read()).rejects.toThrow('User stopped');

  controller.abort(new Error('User stopped'));
  await rejected;

  expect(signal?.aborted).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('cleans up after the caller cancels consumption or a provider throws', async () => {
  const cancel = vi.fn();
  const model = modelTimeout(new MockLanguageModelV4({
    doStream: async () => ({ stream: new ReadableStream({ cancel }) }),
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
