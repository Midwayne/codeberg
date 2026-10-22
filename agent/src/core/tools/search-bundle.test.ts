import { expect, it, vi } from 'vitest';
import type { DaemonClient } from '../client.js';
import { searchBundleSource } from './search-bundle.js';

function hit(repo: string, id: number) {
  return { repo, id, path: `src/${repo}-${id}.ts`, symbol: `auth${id}`, start_line: 1, end_line: 4, score: 1, snippet: 'auth' };
}

async function execute(daemon: unknown, input: unknown, onResults = vi.fn()) {
  const tools = await searchBundleSource({ daemon: daemon as DaemonClient, onResults }).tools();
  return (tools.search_bundle.execute as any)(input, { toolCallId: 'bundle', messages: [] });
}

it('composes scoped read-only searches and chunk reads into one bounded, deduplicated evidence bundle', async () => {
  const daemon = { callTool: vi.fn(async (name: string, args: any) => {
    if (name === 'hybrid_search') return [1, 2, 1].map((id) => ({ hit: hit(args.repo, id), final_score: 1 }));
    if (name === 'get_chunk') return { ...hit(args.repo, args.id), body: 'x'.repeat(5000) };
    throw new Error(`unexpected tool ${name}`);
  }) };
  const captured = vi.fn();
  const output = await execute(daemon, { queries: [{ repo: 'api', query: 'auth' }, { repo: 'worker', query: 'auth' }] }, captured);
  expect(output.evidence.map((row: any) => [row.repo, row.id])).toEqual([['api', 1], ['worker', 1], ['api', 2], ['worker', 2]]);
  expect(JSON.stringify(output).length).toBeLessThanOrEqual(10_000);
  expect(output.evidence.every((row: any) => row.truncated)).toBe(true);
  expect(daemon.callTool.mock.calls.filter(([name]) => name === 'get_chunk')).toHaveLength(4);
  expect(new Set(daemon.callTool.mock.calls.map(([name]) => name))).toEqual(new Set(['hybrid_search', 'get_chunk']));
  expect(captured).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ repo: 'api', id: 1 })]));
});

it('keeps lexical evidence and partial failures explicit instead of inventing chunk identities', async () => {
  const daemon = { callTool: vi.fn(async (name: string, args: any) => {
    if (args.repo === 'broken') throw new Error('index unavailable');
    if (name === 'hybrid_search') return [{ hit: hit('api', 0), context: 'lexical context', context_truncated: false }];
    throw new Error('id=0 must not be fetched');
  }) };
  const output = await execute(daemon, { queries: [{ repo: 'api', query: 'auth' }, { repo: 'broken', query: 'auth' }] });
  expect(output.evidence).toEqual([expect.objectContaining({ id: 0, body: 'lexical context' })]);
  expect(output.errors).toEqual([expect.objectContaining({ repo: 'broken', stage: 'search' })]);
  expect(daemon.callTool).toHaveBeenCalledTimes(2);
});

it('rejects unbounded plans and arbitrary code before calling the daemon', async () => {
  const daemon = { callTool: vi.fn() };
  for (const input of [ { code: 'writeFile()' }, { queries: [] },
    { queries: Array.from({ length: 5 }, () => ({ repo: 'api', query: 'auth' })) },
    { queries: [{ repo: 'api', query: 'x'.repeat(1001) }] } ]) {
    await expect(execute(daemon, input)).rejects.toThrow();
  }
  expect(daemon.callTool).not.toHaveBeenCalled();
});
