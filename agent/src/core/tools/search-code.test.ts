import { describe, expect, it, vi } from 'vitest';

import { DaemonError, type DaemonClient } from '../client.js';
import type { SearchResult } from '../types.js';
import { searchCodeSource } from './search-code.js';

function hit(id: number): SearchResult {
  return {
    id,
    path: `f${id}.ts`,
    symbol: `s${id}`,
    start_line: 1,
    end_line: 2,
    score: 1,
    snippet: 'code',
  };
}

// ai-sdk tool.execute takes a second (options) argument; tests don't use it.
function run(toolDef: unknown, input: unknown): Promise<any> {
  return (toolDef as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, {
    toolCallId: 't',
    messages: [],
  }) as Promise<any>;
}

describe('searchCodeSource', () => {
  it('expands only the top three chunks within a shared output budget', async () => {
    const hits = [1, 2, 3, 4].map((id) => ({ ...hit(id), repo: 'alpha' }));
    const daemon = {
      search: vi.fn(async () => hits),
      callTool: vi.fn(async (_name: string, args: { id: number }) => ({
        body: String(args.id).repeat(4000), truncated: false,
      })),
    } as unknown as DaemonClient;
    const captured: SearchResult[] = [];
    const source = searchCodeSource({ daemon, defaultK: 8, onResults: (h) => captured.push(...h) });

    const out = await run((await source.tools()).search_code, { query: 'auth' });
    expect(daemon.callTool).toHaveBeenCalledTimes(3);
    expect(daemon.callTool).toHaveBeenCalledWith('get_chunk', { repo: 'alpha', id: 1 });
    expect(out.map((r: { body?: string }) => r.body?.length)).toEqual([2500, 2500, 1000, undefined]);
    expect(out[0]).toMatchObject({ snippet: 'code', body: '1'.repeat(2500), truncated: true });
    expect(out[3]).not.toHaveProperty('body');
    expect(captured).toEqual(hits);
  });

  it('keeps search results when a chunk cannot be fetched', async () => {
    const hits = [1, 2].map((id) => ({ ...hit(id), repo: 'alpha' }));
    const daemon = {
      search: vi.fn(async () => hits),
      callTool: vi.fn(async (_name: string, args: { id: number }) => {
        if (args.id === 1) throw new Error('chunk no longer indexed');
        return { body: 'full function', truncated: false };
      }),
    } as unknown as DaemonClient;
    const source = searchCodeSource({ daemon, defaultK: 8, onResults: () => {} });
    const out = await run((await source.tools()).search_code, { query: 'auth' });
    expect(out[0]).toMatchObject({ snippet: 'code' });
    expect(out[0]).not.toHaveProperty('body');
    expect(out[1]).toMatchObject({ body: 'full function', truncated: false });
  });

  it('spends expansion budget on a query-matching hit beyond the first three', async () => {
    const hits = [1, 2, 3, 4].map((id) => ({
      ...hit(id), repo: 'alpha', score: 1 - id * 0.01,
      path: id === 4 ? 'src/obligationMetricsService.ts' : `src/unrelated${id}.ts`,
    }));
    const daemon = {
      search: vi.fn(async () => hits),
      callTool: vi.fn(async (_name: string, args: { id: number }) => ({ body: `body ${args.id}` })),
    } as unknown as DaemonClient;
    const source = searchCodeSource({ daemon, defaultK: 8, onResults: () => {} });
    const out = await run((await source.tools()).search_code, { query: 'obligation metrics service' });
    expect(daemon.callTool).toHaveBeenCalledWith('get_chunk', { repo: 'alpha', id: 4 });
    expect(out[3]).toMatchObject({ body: 'body 4' });
    expect(out[0].path).toBe('src/unrelated1.ts'); // ranking remains the daemon's
  });
  it('returns actionable daemon errors to the model', async () => {
    const daemon = {
      search: vi.fn(async () => { throw new DaemonError('INTERNAL', 'indexer connect: socket missing', 500); }),
    } as unknown as DaemonClient;
    const source = searchCodeSource({ daemon, defaultK: 8, onResults: () => {} });
    expect(await run((await source.tools()).search_code, { query: 'metrics' })).toEqual({
      error: 'INTERNAL: indexer connect: socket missing',
    });
  });
  it('searches, reports full hits to the sink, and returns compact chunks', async () => {
    const hits = [hit(1), hit(2)];
    const daemon = {
      search: vi.fn(async () => hits),
    } as unknown as DaemonClient;
    const captured: SearchResult[] = [];
    const source = searchCodeSource({
      daemon,
      defaultK: 8,
      onResults: (h) => captured.push(...h),
    });

    const out = await run((await source.tools()).search_code, {
      query: 'auth',
    });

    expect(daemon.search).toHaveBeenCalledWith('auth', { k: 8 });
    expect(captured).toEqual(hits); // sink got the full hits
    expect(out).toEqual([
      {
        id: 1,
        path: 'f1.ts',
        symbol: 's1',
        lines: '1-2',
        score: 1,
        snippet: 'code',
      },
      {
        id: 2,
        path: 'f2.ts',
        symbol: 's2',
        lines: '1-2',
        score: 1,
        snippet: 'code',
      },
    ]); // model gets only compact chunks
  });

  it('honours an explicit k', async () => {
    const daemon = { search: vi.fn(async () => []) } as unknown as DaemonClient;
    const source = searchCodeSource({
      daemon,
      defaultK: 8,
      onResults: () => {},
    });
    await run((await source.tools()).search_code, { query: 'q', k: 3 });
    expect(daemon.search).toHaveBeenCalledWith('q', { k: 3 });
  });

  it('scopes to a repo and surfaces repo keys in the chunks', async () => {
    const tagged: SearchResult = { ...hit(1), repo: 'alpha' };
    const daemon = {
      search: vi.fn(async () => [tagged]),
    } as unknown as DaemonClient;
    const source = searchCodeSource({
      daemon,
      defaultK: 8,
      onResults: () => {},
    });

    const out = await run((await source.tools()).search_code, {
      query: 'q',
      repo: 'alpha',
    });

    expect(daemon.search).toHaveBeenCalledWith('q', { k: 8, repo: 'alpha' });
    expect(out).toEqual([
      {
        id: 1,
        repo: 'alpha',
        path: 'f1.ts',
        symbol: 's1',
        lines: '1-2',
        score: 1,
        snippet: 'code',
      },
    ]);
  });

  it('forwards search filters to the daemon', async () => {
    const daemon = { search: vi.fn(async () => []) } as unknown as DaemonClient;
    const source = searchCodeSource({
      daemon,
      defaultK: 8,
      onResults: () => {},
    });
    await run((await source.tools()).search_code, {
      query: 'auth',
      path_glob: 'daemon/*',
      kind: 'function',
      min_score: 0.7,
    });
    expect(daemon.search).toHaveBeenCalledWith('auth', {
      k: 8,
      path_glob: 'daemon/*',
      kind: 'function',
      min_score: 0.7,
    });
  });
});
