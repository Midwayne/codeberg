import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolLoopAgent } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createWebServer, type WebServerOptions } from '../server.js';
import { UsageStore } from './store.js';
import { ResourceSettings } from '../resources.js';
import { WebSessionStore } from '../sessions/store.js';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(options: Partial<WebServerOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'codeberg-usage-api-'));
  const usage = new UsageStore(directory);
  const sessions = new WebSessionStore(join(directory, 'sessions'));
  const resources = new ResourceSettings({ sessions, home: directory, monitor: {
    start() {}, stop() {}, invalidateDisk() {}, read: () => '{}',
  } });
  const server = createWebServer({ title: 'test', usage, sessionStore: sessions, resources, ...options });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  return { usage, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/settings/usage` };
}

describe('usage API', () => {
  it('keeps a disconnected model request alive until an explicit server Stop', async () => {
    let signal: AbortSignal | undefined;
    const model = new MockLanguageModelV4({ doStream: async (options) => {
      signal = options.abortSignal;

      return { stream: new ReadableStream({ start(next) {
        next.enqueue({ type: 'text-start', id: 'text' });
        next.enqueue({ type: 'text-delta', id: 'text', delta: 'Working' });
        signal?.addEventListener('abort', () => next.error(new DOMException('Stopped', 'AbortError')));
      } }) };
    } });
    const { url } = await fixture({ agent: new ToolLoopAgent({ model }) });
    const stop = new AbortController();
    const response = await fetch(url.replace('/settings/usage', '/chat'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: stop.signal,
      body: JSON.stringify({ id: 'chat', messages: [{ id: 'question', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }] }),
    });

    await response.body!.getReader().read();
    stop.abort();

    expect(signal?.aborted).toBe(false);
    const stopped = await fetch(url.replace('/settings/usage', '/chat/chat/stop'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: response.headers.get('x-codeberg-run') }),
    });
    expect(stopped.status).toBe(200);
    expect(signal?.aborted).toBe(true);
  });

  it('captures real streamed agent steps through the default web responder', async () => {
    const model = new MockLanguageModelV4({ doStream: async () => ({
      stream: new ReadableStream({ start(controller) {
        controller.enqueue({ type: 'text-start', id: 'text-1' });
        controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'hello' });
        controller.enqueue({ type: 'text-end', id: 'text-1' });
        controller.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: {
          inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        } });
        controller.close();
      } }),
    }) });
    const { usage, url } = await fixture({ agent: new ToolLoopAgent({ model }) });
    const response = await fetch(url.replace('/settings/usage', '/chat'), { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }] }),
    });
    await response.text();
    const now = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.parse(now) + 86_400_000).toISOString().slice(0, 10);
    const rows = await usage.read(now, end);

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inputTokens: 20, outputTokens: 5, kind: 'chat', costUsd: null });
  });

  it('reports spend across projects and exports the full filtered range, independent of pagination', async () => {
    const { usage, url } = await fixture();
    await Promise.all(['Alpha', 'Beta'].map((project) => usage.record({
      project, projectName: project, model: 'custom:model', key: 'custom:key', kind: 'chat',
      inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0,
      costUsd: 0.1, timestamp: Date.UTC(2026, 9, 1),
    })));
    const query = '?start=2026-10-01&end=2026-10-03';
    const response = await fetch(url + query);
    const report = await response.json();

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(report.totals).toMatchObject({ requests: 2, costUsd: 0.2 });
    expect(report.records.map((row: { project: string }) => row.project).sort()).toEqual(['Alpha', 'Beta']);
    const csv = await fetch(url + query + '&format=csv&page=2');
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const content = await csv.text();

    expect(content.split('\r\n')).toHaveLength(4);
    expect(content.split('\r\n')[0]).toBe('Date (UTC),Project,Type,Model,Model key,Input tokens,Output tokens');
    expect(content).not.toMatch(/cache|estimated|cost/i);
  });

  it('rejects malformed, reversed, excessive ranges and unsupported methods', async () => {
    const { url } = await fixture();
    for (const query of ['?start=oops', '?start=2026-02-30&end=2026-03-02',
      '?start=2026-10-03&end=2026-10-01', '?start=2020-01-01&end=2026-10-01', '?page=0', '?kind=other', '?kind=']) {
      expect((await fetch(url + query)).status).toBe(400);
    }
    expect((await fetch(url, { method: 'POST' })).status).toBe(405);
  });

  it('filters activity before totals, daily/model aggregation, pagination and CSV export', async () => {
    const { usage, url } = await fixture();
    await Promise.all(Array.from({ length: 52 }, (_, index) => usage.record({
      project: 'Alpha', model: 'custom:shared', key: 'custom:key', kind: index % 2 ? 'chat' : 'learning',
      inputTokens: index % 2 ? 10 : 100, outputTokens: index % 2 ? 2 : null,
      cacheReadTokens: null, cacheWriteTokens: null, costUsd: null,
      timestamp: Date.UTC(2026, 9, index % 2 ? 1 : 2, 0, index),
    })));
    const query = '?start=2026-10-01&end=2026-10-03';
    const all = await (await fetch(url + query + '&kind=all')).json();

    expect(all.totals.requests).toBe(52);
    expect(all.kinds.chat).toMatchObject({ requests: 26, inputTokens: 260, outputTokens: 52 });
    expect(all.kinds.learning).toMatchObject({ requests: 26, inputTokens: 2600, unreportedRequests: 26 });

    for (const kind of ['chat', 'learning']) {
      const report = await (await fetch(url + query + `&kind=${kind}&page=2`)).json();

      expect(report.totals).toEqual(all.kinds[kind]);
      expect(report.records).toHaveLength(1);
      expect(report.records[0].kind).toBe(kind);
      expect(report.models).toHaveLength(1);
      expect(report.models[0]).toMatchObject(all.kinds[kind]);
      expect(report.daily).toHaveLength(1);
      expect(report.daily[0]).toMatchObject(all.kinds[kind]);

      const csv = await (await fetch(url + query + `&kind=${kind}&format=csv&page=2`)).text();

      expect(csv.split('\r\n')).toHaveLength(28);
      expect(csv).toContain(`"${kind}"`);
      expect(csv).not.toContain(`"${kind === 'chat' ? 'learning' : 'chat'}"`);
    }

    const empty = await (await fetch(url + '?start=2026-10-02&end=2026-10-03&kind=chat')).json();

    expect(empty.totals.requests).toBe(0);
    expect(empty.records).toEqual([]);
    expect(empty.daily).toEqual([]);
    expect(empty.models).toEqual([]);
  });

  it('paginates requests while keeping period totals and model breakdown intact', async () => {
    const { usage, url } = await fixture();
    await Promise.all(Array.from({ length: 26 }, (_, index) => usage.record({
      project: index % 2 ? 'p-alpha' : 'p-beta', model: 'custom:model', key: 'custom:key', kind: 'chat',
      inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0,
      costUsd: 1, timestamp: Date.UTC(2026, 9, 1, 0, index),
    })));
    const report = await (await fetch(url + '?start=2026-10-01&end=2026-10-03&page=2')).json();

    expect(report.records).toHaveLength(1);
    expect(report.totals).toMatchObject({ requests: 26, costUsd: 26 });
    expect(report.models[0]).toMatchObject({ requests: 26, inputTokens: 260 });
  });
});
