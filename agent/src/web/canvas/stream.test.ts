import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasStore } from '../../core/canvas/store.js';
import { closeCanvasStreams, streamCanvas } from './stream.js';

const roots: string[] = [];
const stores: CanvasStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) closeCanvasStreams(store);

  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function response() {
  const res = new EventEmitter() as EventEmitter & Record<string, any>;
  res.writeHead = vi.fn();
  res.flushHeaders = vi.fn();
  res.write = vi.fn(() => true);
  res.end = vi.fn(() => res.emit('close'));
  return res as unknown as ServerResponse;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'canvas-feed-'));
  roots.push(root);
  const store = new CanvasStore(root, '/canvas', true, 'one');
  stores.push(store);
  await store.ensure();
  return store;
}

it('shares one scene read across subscribers and does no half-second idle reads', async () => {
  const store = await fixture();
  const scene = await store.current();
  const current = vi.spyOn(store, 'current').mockResolvedValue(scene);
  vi.useFakeTimers();

  streamCanvas({} as IncomingMessage, response(), store);
  streamCanvas({} as IncomingMessage, response(), store);
  await vi.advanceTimersByTimeAsync(2000);

  expect(current).toHaveBeenCalledTimes(1);
});

it('publishes atomic external changes and releases the feed when the last client closes', async () => {
  const store = await fixture();
  const current = vi.spyOn(store, 'current');
  const first = response();
  const second = response();
  streamCanvas({} as IncomingMessage, first, store);
  streamCanvas({} as IncomingMessage, second, store);
  await vi.waitFor(() => expect(first.write).toHaveBeenCalled());

  await store.change('add', { elements: [{ id: 'updated', type: 'rectangle' }] });
  await vi.waitFor(() => expect(second.write).toHaveBeenCalledWith(expect.stringContaining('updated')));
  first.emit('close');
  second.emit('close');
  current.mockClear();
  await writeFile(join(store.root, 'settings.json'), '{"enabled":false}');
  await new Promise((resolve) => setTimeout(resolve, 100));

  expect(current).not.toHaveBeenCalled();
});

it('reconciles missed events and keeps separate chats isolated', async () => {
  const store = await fixture();
  const scene = await store.current();
  const second = store.forChat('two');
  const current = vi.spyOn(store, 'current').mockResolvedValue(scene);
  vi.spyOn(second, 'current').mockResolvedValue({ ...scene, name: 'chat-two' });
  const firstResponse = response();
  const secondResponse = response();
  vi.useFakeTimers();

  streamCanvas({} as IncomingMessage, firstResponse, store);
  streamCanvas({} as IncomingMessage, secondResponse, second);
  await vi.advanceTimersByTimeAsync(0);
  expect(secondResponse.write).toHaveBeenCalledWith(expect.stringContaining('chat-two'));
  expect(firstResponse.write).not.toHaveBeenCalledWith(expect.stringContaining('chat-two'));

  current.mockResolvedValue({ ...scene, revision: scene.revision + 1 });
  await vi.advanceTimersByTimeAsync(15_000);
  expect(firstResponse.write).toHaveBeenCalledWith(expect.stringContaining(`"revision":${scene.revision + 1}`));
  expect(secondResponse.write).toHaveBeenCalledTimes(2); // Initial scene plus keepalive.
});
