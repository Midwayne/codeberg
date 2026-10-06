import { EventEmitter } from 'node:events';
import type { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResourceMonitorClient } from './resource-monitor.js';

const clients: ResourceMonitorClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.stop();
});

class FakeWorker extends EventEmitter {
  postMessage = vi.fn();
  terminate = vi.fn(async () => 0);

  unref() {}
}

describe('resource monitor transport', () => {
  it('serves a cold cached response immediately while daemon discovery is pending', async () => {
    const pending = new Promise<Response>(() => undefined);
    const client = new ResourceMonitorClient({
      home: '/test',
      sessionsDir: '/test/chats',
      learningRoot: '/test/learning',
      daemonUrl: 'http://127.0.0.1:48080',
      fetch: vi.fn(() => pending),
    });

    clients.push(client);
    client.start();
    const usage = JSON.parse(await client.read());
    expect(usage.current).toBeNull();
    expect(usage.history).toEqual([]);
  });

  it('relays daemon snapshots and cursors without starting an agent collector', async () => {
    const createWorker = vi.fn();
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);

      return url.endsWith('/clients')
        ? new Response(null, { status: 202, headers: { 'X-Codeberg-Pid': '30' } })
        : new Response('{"collector":"daemon","current":null,"history":[]}', {
            headers: { 'X-Codeberg-Pid': '30' },
          });
    });

    const client = new ResourceMonitorClient({
      home: '/test',
      sessionsDir: '/test/chats',
      learningRoot: '/test/learning',
      daemonUrl: 'http://127.0.0.1:48080',
      fetch,
      createWorker,
    });

    clients.push(client);
    client.start();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(await client.read(123)).collector).toBe('daemon');
    expect(String(fetch.mock.calls[1]?.[0])).toContain('after=123');
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('keeps standalone collection in a worker and serves cached deltas during a disk sweep', async () => {
    const worker = new FakeWorker();
    const client = new ResourceMonitorClient({
      home: '/test',
      sessionsDir: '/test/chats',
      learningRoot: '/test/learning',
      createWorker: () => worker as unknown as Worker,
    });

    clients.push(client);
    client.start();
    const sample = { timestamp: 1000, memory: { usedBytes: 123 } };
    worker.emit('message', { kind: 'sample', sample });
    expect(JSON.parse(await client.read()).current).toEqual(sample);
    expect(JSON.parse(await client.read(1000)).history).toEqual([]);
    client.invalidateDisk();
    expect(worker.postMessage).toHaveBeenCalledWith({ kind: 'refreshDisk' });
    expect(JSON.parse(await client.read()).current).toEqual(sample);
  });

  it('bounds worker history and replaces disk updates without duplicating timestamps', async () => {
    const worker = new FakeWorker();
    const client = new ResourceMonitorClient({
      home: '/test',
      sessionsDir: '/test/chats',
      learningRoot: '/test/learning',
      createWorker: () => worker as unknown as Worker,
    });

    clients.push(client);
    client.start();
    for (let i = 1; i <= 400; i++)
      worker.emit('message', { kind: 'sample', sample: { timestamp: i * 10_000 } });

    worker.emit('message', {
      kind: 'sample',
      sample: { timestamp: 4_000_000, disk: { codebergBytes: 100 } },
    });
    const usage = JSON.parse(await client.read());
    expect(usage.history).toHaveLength(360);
    expect(usage.current.disk.codebergBytes).toBe(100);
    expect(JSON.parse(await client.read(3_990_000)).history).toHaveLength(1);
  });
});
