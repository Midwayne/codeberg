import { describe, expect, it, vi } from 'vitest';

import type { DaemonClient } from '../client.js';
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
