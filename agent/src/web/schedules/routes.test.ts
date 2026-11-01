import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { UIMessageChunk } from 'ai';
import { afterEach, expect, it } from 'vitest';
import { SearchRuns } from '../runs/manager.js';
import { createWebServer } from '../server.js';
import { WebSessionStore } from '../sessions/store.js';

let directory: string;
let server: Server;
let runs: SearchRuns;

afterEach(async () => {
  await runs?.close();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  directory = await mkdtemp(join(tmpdir(), 'codeberg-schedule-routes-'));
  const sessions = new WebSessionStore(directory);
  await sessions.upsert({ id: 'first', title: 'First investigation', messages: [] });
  await sessions.upsert({ id: 'second', title: 'Another chat', messages: [] });
  runs = new SearchRuns(sessions, async () => ({ stream: new ReadableStream<UIMessageChunk>() }));
  const first = await runs.schedules.create({ chatId: 'first', sourceRunId: 'origin' }, { prompt: 'Check logs', delay_seconds: 60 });
  const second = await runs.schedules.create({ chatId: 'second', sourceRunId: 'origin' }, { prompt: 'Inspect changes', delay_seconds: 60 });
  server = createWebServer({ title: 'No model configured', sessionStore: sessions, runs });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  return { first, second, sessions, base };
}

it('lists schedules across all chats without requiring a configured model', async () => {
  const f = await fixture();
  await f.sessions.remove('second');
  const response = await fetch(`${f.base}/api/schedules`);

  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject([
    { id: f.first.id, chatId: 'first', chatTitle: 'First investigation', prompt: 'Check logs' },
    { id: f.second.id, chatId: 'second', chatTitle: 'Deleted chat', chatDeleted: true },
  ]);
});

it('lets the user cancel a schedule from another chat and keeps it cancelled after reload', async () => {
  const f = await fixture();
  const response = await fetch(`${f.base}/api/schedules/${f.second.id}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: f.second.id, stopping: false });
  const jobs = await (await fetch(`${f.base}/api/schedules`)).json();
  expect(jobs.find((job: { id: string }) => job.id === f.second.id).status).toBe('cancelled');
  expect((await runs.schedules.list('first'))[0]?.status).toBe('scheduled');
});

it('cancels future occurrences and signals the active occurrence to stop', async () => {
  const f = await fixture();
  await runs.schedules.tick(f.first.dueAt!);
  const active = (await runs.find('first'))!;
  const response = await fetch(`${f.base}/api/schedules/${f.first.id}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ stopping: true });
  expect(active.controller.signal.aborted).toBe(true);
  await active.done;
  expect((await runs.schedules.list('first'))[0]?.status).toBe('cancelled');
});

it('rejects cross-origin cancellation, unsupported methods, and unknown IDs', async () => {
  const f = await fixture();
  const url = `${f.base}/api/schedules/${f.first.id}/cancel`;
  expect((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://elsewhere.example' } })).status).toBe(403);
  expect((await fetch(url)).status).toBe(405);
  expect((await fetch(url, { method: 'POST' })).status).toBe(415);
  expect((await fetch(`${f.base}/api/schedules/missing/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })).status).toBe(404);
  expect((await runs.schedules.list('first'))[0]?.status).toBe('scheduled');
});

it('shows and cancels background tools across chats without a configured model', async () => {
  const f = await fixture();
  let signal!: AbortSignal;
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => { finish = resolve; });
  const job = await runs.background.start({ chatId: 'second', sourceRunId: 'turn' },
    { tool: 'kafka_scan_messages', callId: 'scan', args: { topic: 'events' } }, (value) => { signal = value; return pending; });
  try {
    const response = await fetch(`${f.base}/api/schedules`);
    expect(await response.json()).toEqual(expect.arrayContaining([expect.objectContaining({
      id: job.id, kind: 'background', backgroundStatus: 'running', chatTitle: 'Another chat',
    })]));
    const blocked = await fetch(`${f.base}/api/sessions/second`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
    expect(blocked.status).toBe(409);
    const cancelled = await fetch(`${f.base}/api/schedules/${job.id}/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ id: job.id, kind: 'background', stopping: true });
    expect(signal.aborted).toBe(true);
  } finally {
    finish(null);
  }
});
