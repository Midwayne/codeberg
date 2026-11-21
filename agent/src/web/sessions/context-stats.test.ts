import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chatScope } from '../../core/chat-scope.js';
import type { ContextRequestReport } from '../../core/request-budget/report.js';
import { emitContextEvent } from '../../core/request-budget/report.js';
import { applyContextEvent, contextStatsPath, emptyContextStats, readContextStats, trackChatContext } from './context-stats.js';
import { routeSessions } from './routes.js';
import { WebSessionStore } from './store.js';

const cleanup: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function report(estimated: number, cleared = 0, summarized = false): ContextRequestReport {
  return {
    at: estimated,
    model: 'test:model',
    window: 200_000,
    ceiling: 160_000,
    clearAt: 80_000,
    estimated,
    breakdown: { instructions: 2_000, context: 500, tools: 1_500, conversation: estimated - 4_000, toolResults: 0, cleared: 0, summary: 0, attachments: 0 },
    counts: { messages: 4, toolResults: 2, cleared, spilled: 0 },
    summarized,
    usage: { input: estimated, cacheRead: estimated / 2, cacheWrite: 0, output: 10 },
  };
}

async function sessions() {
  const root = await mkdtemp(join(tmpdir(), 'cberg-context-stats-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));

  return new WebSessionStore(join(root, 'sessions'));
}

describe('applyContextEvent', () => {
  it('counts requests, compactions, clearing passes, peak size, and cache reads', () => {
    let stats = emptyContextStats();

    stats = applyContextEvent(stats, { type: 'request', report: report(10_000) });
    stats = applyContextEvent(stats, { type: 'request', report: report(90_000, 8) });
    stats = applyContextEvent(stats, { type: 'request', report: report(91_000, 8) });
    stats = applyContextEvent(stats, { type: 'compaction', at: 1 });
    stats = applyContextEvent(stats, { type: 'request', report: report(20_000, 0, true) });

    expect(stats).toMatchObject({ requests: 4, compactions: 1, clearingPasses: 1, peak: 91_000, inputTokens: 211_000, cacheReadTokens: 105_500 });
    expect(stats.last?.estimated).toBe(20_000);
    expect(stats.recent.map((point) => point.summarized)).toEqual([false, false, false, true]);
  });
});

describe('trackChatContext', () => {
  it('saves events for web chats and serves them from the session route', async () => {
    const store = await sessions();
    cleanup.push(trackChatContext());

    await chatScope.run(join(store.dir, 'chat-1'), async () => {
      emitContextEvent({ type: 'request', report: report(12_000) });
      emitContextEvent({ type: 'compaction', at: 2 });
    });

    await vi.waitFor(async () => expect((await readContextStats(store.dir, 'chat-1')).compactions).toBe(1));

    const server = createServer((req, res) => void routeSessions(req, res, store, req.url ?? ''));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const body = await (await fetch(`${base}/api/sessions/chat-1/context`)).json();
    expect(body).toMatchObject({ requests: 1, compactions: 1, last: { estimated: 12_000 } });

    const missing = await (await fetch(`${base}/api/sessions/chat-2/context`)).json();
    expect(missing).toEqual(emptyContextStats());

    expect((await fetch(`${base}/api/sessions/..%2Fx/context`)).status).toBe(400);
  });

  it('ignores events outside a chat and removes stats with the chat', async () => {
    const store = await sessions();
    cleanup.push(trackChatContext());

    emitContextEvent({ type: 'request', report: report(1_000) });
    await chatScope.run(join(store.dir, 'chat-3'), async () => emitContextEvent({ type: 'request', report: report(1_000) }));
    await vi.waitFor(() => expect(existsSync(contextStatsPath(store.dir, 'chat-3'))).toBe(true));

    await store.upsert({ id: 'chat-3', messages: [] });
    await store.remove('chat-3');

    expect(existsSync(contextStatsPath(store.dir, 'chat-3'))).toBe(false);
  });

  it('removes stats even when the chat record is already gone', async () => {
    const store = await sessions();
    cleanup.push(trackChatContext());

    await chatScope.run(join(store.dir, 'chat-4'), async () => emitContextEvent({ type: 'request', report: report(1_000) }));
    await vi.waitFor(() => expect(existsSync(contextStatsPath(store.dir, 'chat-4'))).toBe(true));

    await store.remove('chat-4');

    expect(existsSync(contextStatsPath(store.dir, 'chat-4'))).toBe(false);
  });
});
