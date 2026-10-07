import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { UsageStore } from './store.js';
import { estimateCost } from './cost.js';
import { summarizeUsage } from './summary.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-usage-'));
  directories.push(directory);

  return directory;
}

const tokens = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 400, cacheWriteTokens: 100 };
const pricing = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

describe('model usage', () => {
  it('prices cache reads and writes separately without double-counting input', () => {
    expect(estimateCost(tokens, pricing)).toBeCloseTo(0.00333);
    expect(estimateCost(tokens, undefined)).toBeNull();
    expect(estimateCost(tokens, { input: 2, output: 10 })).toBeNull();
    expect(estimateCost({ ...tokens, outputTokens: null }, pricing)).toBeNull();
    expect(estimateCost({ ...tokens, cacheReadTokens: null }, pricing)).toBeNull();
    expect(estimateCost(tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(0);
  });

  it('persists concurrent calls, survives restart, and filters UTC date boundaries', async () => {
    const directory = await fixture();
    const store = new UsageStore(directory);
    await Promise.all([0, 1, 2].map((day) => store.record({
      model: 'custom:model', key: 'custom:variant', kind: 'chat', ...tokens, costUsd: 0.00333,
      timestamp: Date.UTC(2026, 8, 30 + day),
    })));

    const restarted = new UsageStore(directory);
    const rows = await restarted.read('2026-10-01', '2026-10-03');

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.timestamp)).toEqual([Date.UTC(2026, 9, 2), Date.UTC(2026, 9, 1)]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(rows[0].key).toBe('custom:variant');
  });

  it('keeps unpriced and unreported usage visible and aggregates by day and model', async () => {
    const directory = await fixture();
    const store = new UsageStore(directory);
    await store.record({ model: 'custom:model', key: 'custom:variant', kind: 'learning',
      ...tokens, costUsd: 1, timestamp: Date.UTC(2026, 9, 1) });
    await store.record({ model: 'custom:other', key: 'custom:other', kind: 'chat',
      inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null,
      costUsd: null, timestamp: Date.UTC(2026, 9, 2) });

    const summary = summarizeUsage(await store.read('2026-10-01', '2026-10-03'));

    expect(summary.totals).toMatchObject({ requests: 2, inputTokens: 1000, outputTokens: 200,
      costUsd: 1, unpricedRequests: 1, unreportedRequests: 1 });
    expect(summary.daily).toHaveLength(2);
    expect(summary.models.map((model) => model.model)).toEqual(['custom:model', 'custom:other']);
  });

  it('returns an empty history on first use and reports corrupt records', async () => {
    const directory = await fixture();
    const store = new UsageStore(directory);
    expect(await store.read('2026-10-01', '2026-10-03')).toEqual([]);

    await writeFile(join(directory, '2026-10.jsonl'), '{broken}\n');
    await expect(store.read('2026-10-01', '2026-10-03')).rejects.toThrow();
  });

  it('reports a failed write and resumes recording after storage recovers', async () => {
    const directory = await fixture();
    const store = new UsageStore(directory);
    const path = join(directory, '2026-10.jsonl');
    await mkdir(path);
    const input = { model: 'custom:model', key: 'custom:key', kind: 'chat' as const,
      ...tokens, costUsd: 0.1, timestamp: Date.UTC(2026, 9, 1) };

    await expect(store.record(input)).rejects.toThrow();
    await rm(path, { recursive: true });
    await store.record(input);

    expect(store.failedWrites).toBe(1);
    expect(await store.read('2026-10-01', '2026-10-02')).toHaveLength(1);
  });
});
