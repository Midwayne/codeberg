import { describe, expect, it } from 'vitest';

import { searxngProvider } from './searxng.js';

function res(opts: { ok?: boolean; status?: number; json?: unknown }): Response {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: '',
    headers: { get: () => null },
    json: async () => opts.json ?? { results: [] },
  } as unknown as Response;
}

function provider(fetchImpl: typeof fetch) {
  return searxngProvider({
    baseUrl: 'http://sx:8888',
    timeoutMs: 5000,
    fetchImpl,
  });
}

describe('searxngProvider', () => {
  it('queries /search?format=json and maps results, dropping url-less entries', async () => {
    const calls: string[] = [];
    const p = provider((async (input: unknown) => {
      calls.push(String(input));
      return res({
        json: {
          results: [
            { title: 'A', url: 'https://a', content: 'snip' },
            { url: 'https://b' },
            { title: 'C', content: 'no url' },
          ],
        },
      });
    }) as unknown as typeof fetch);

    const out = await p.search('hello world', { count: 6 });
    expect(calls[0]).toContain('http://sx:8888/search');
    expect(calls[0]).toContain('q=hello+world');
    expect(calls[0]).toContain('format=json');
    expect(out).toEqual([
      { title: 'A', url: 'https://a', snippet: 'snip' },
      { title: '', url: 'https://b', snippet: '' },
    ]);
  });

  it('slices to count', async () => {
    const p = provider((async () =>
      res({
        json: {
          results: [{ url: 'https://1' }, { url: 'https://2' }, { url: 'https://3' }],
        },
      })) as unknown as typeof fetch);
    expect(await p.search('q', { count: 2 })).toHaveLength(2);
  });

  it('throws on a non-ok response', async () => {
    const p = provider((async () => res({ ok: false, status: 403 })) as unknown as typeof fetch);
    await expect(p.search('q', { count: 6 })).rejects.toThrow(/web search failed/);
  });
});
