import { expect, it, vi } from 'vitest';
import { webTools } from './tools.js';
import type { WebConfig } from './types.js';

const config: WebConfig = {
  enabled: true, searchEnabled: true, searxngUrl: 'http://search:8888',
  maxBytes: 1_000_000, maxChars: 20_000, timeoutMs: 60_000,
  searchCount: 6, allowPrivate: false,
};

it.each(['fetch_url', 'web_search'])('cancels the network request for %s when the turn stops', async (name) => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  let rejectRequest!: (reason: Error) => void;
  const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => {
    requestSignal = options?.signal;

    return new Promise((_resolve, reject) => {
      rejectRequest = reject;
      requestSignal?.addEventListener('abort', () => reject(requestSignal?.reason), { once: true });
    });
  });
  const tools = webTools(config, { fetchImpl });
  const execute = tools[name]!.execute! as (input: unknown, options: unknown) => Promise<unknown>;
  const pending = execute(name === 'fetch_url' ? { url: 'https://example.com' } : { query: 'auth' }, {
    toolCallId: 'call', messages: [], abortSignal: controller.signal,
  });
  const outcome = pending.catch((error: unknown) => error);
  await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());

  try {
    controller.abort(new Error('Stopped by user'));

    expect(requestSignal?.aborted).toBe(true);
    expect(await outcome).toEqual(new Error('Stopped by user'));
  } finally {
    rejectRequest(new Error('Test cleanup'));
    await outcome;
  }
});

it.each(['fetch_url', 'web_search'])('does not start %s after the turn has stopped', async (name) => {
  const fetchImpl = vi.fn<typeof fetch>();
  const execute = webTools(config, { fetchImpl })[name]!.execute! as (input: unknown, options: unknown) => Promise<unknown>;

  await expect(execute(name === 'fetch_url' ? { url: 'https://example.com' } : { query: 'auth' }, {
    toolCallId: 'call', messages: [], abortSignal: AbortSignal.abort(new Error('Already stopped')),
  })).rejects.toThrow('Already stopped');

  expect(fetchImpl).not.toHaveBeenCalled();
});
