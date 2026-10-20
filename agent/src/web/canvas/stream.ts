import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { CanvasStore } from '../../core/canvas/store.js';
import { CanvasFeed } from './feed.js';

const feeds = new Map<string, CanvasFeed>();

export function closeCanvasStreams(store: CanvasStore): void {
  for (const feed of feeds.values()) {
    if (resolve(feed.store.root) !== resolve(store.root)) continue;

    for (const client of feed.clients) client.end();
  }
}

export function streamCanvas(_req: IncomingMessage, res: ServerResponse, store: CanvasStore): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const key = `${resolve(store.root)}\0${store.chatId ?? ''}`;
  let feed = feeds.get(key);
  if (!feed) {
    feed = new CanvasFeed(store);
    feeds.set(key, feed);
  }

  const active = feed;
  res.once('close', () => {
    active.clients.delete(res);
    if (active.clients.size) return;

    active.stop();
    feeds.delete(key);
  });
  active.add(res);
}
