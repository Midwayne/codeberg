import { watch, type FSWatcher } from 'node:fs';
import type { ServerResponse } from 'node:http';
import type { CanvasStore } from '../../core/canvas/store.js';
import { CanvasError } from '../../core/canvas/types.js';
import { writeModuleLog } from '../../core/module-log.js';

/** One watched scene per root/chat, shared by all its browser subscribers. */
export class CanvasFeed {
  readonly clients = new Set<ServerResponse>();
  private watcher?: FSWatcher;
  private debounce?: NodeJS.Timeout;
  private readonly timer: NodeJS.Timeout;
  private previous = '';
  private wire?: string;
  private busy = false;
  private pending = false;
  private stopped = false;

  constructor(readonly store: CanvasStore) {
    this.watch();
    this.timer = setInterval(() => {
      this.watch();
      void this.refresh();
      for (const client of this.clients) this.send(client, ': keepalive\n\n');
    }, 15_000);
    this.timer.unref();
  }

  add(client: ServerResponse): void {
    this.clients.add(client);
    if (this.wire) this.send(client, this.wire);
    else if (!this.busy) void this.refresh();
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.close();
    clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
  }

  private watch(): void {
    if (this.watcher || this.stopped) return;

    try {
      this.watcher = watch(this.store.root, { persistent: false }, (_event, filename) => {
        const name = filename?.toString();
        if (name && this.store.chatId && name !== 'settings.json' && name !== `chat-${this.store.chatId}.excalidraw`) return;
        if (this.debounce) clearTimeout(this.debounce);

        this.debounce = setTimeout(() => {
          this.debounce = undefined;
          void this.refresh();
        }, 50);
        this.debounce.unref();
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = undefined;
      });
    } catch {
      // Missing directories and unsupported watches use periodic reconciliation.
    }
  }

  private async refresh(): Promise<void> {
    if (this.stopped) return;
    if (this.busy) {
      this.pending = true;
      return;
    }
    this.busy = true;
    try {
      const scene = await this.store.current();
      this.publish(`scene:${scene.name}:${scene.revision}`, () => JSON.stringify({ scene }));
    } catch (error) {
      if (error instanceof CanvasError && error.status === 404) {
        this.publish('empty', () => '{"scene":null}');
      } else {
        const message = error instanceof Error ? error.message : 'Canvas unavailable.';
        this.publish(`error:${message}`, () => JSON.stringify({ error: message }));
        if (!(error instanceof CanvasError)) writeModuleLog('agent', 'canvas_stream_failed', { error: String(error) });
      }
    } finally {
      this.busy = false;
      if (this.pending) {
        this.pending = false;
        void this.refresh();
      }
    }
  }

  private publish(key: string, encode: () => string): void {
    if (this.stopped || key === this.previous) return;

    this.previous = key;
    this.wire = `data: ${encode()}\n\n`;
    for (const client of this.clients) this.send(client, this.wire);
  }

  private send(client: ServerResponse, message: string): void {
    if (!client.destroyed && !client.writableEnded && !client.write(message)) client.end();
  }
}
