import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CanvasStore } from '../src/core/canvas/store.js';
import { closeCanvasStreams, streamCanvas } from '../src/web/canvas/stream.js';

const root = await mkdtemp(join(tmpdir(), 'canvas-bench-'));
const store = new CanvasStore(root, '/canvas', true, 'bench');
await store.ensure();
await store.change('add', { elements: Array.from({ length: 1000 }, (_, i) => ({
  id: `element-${i}`, type: 'rectangle' as const,
})) });
let reads = 0;
const current = store.current.bind(store);
store.current = async () => {
  reads++;
  return current();
};

const start = process.cpuUsage();
for (let i = 0; i < 4; i++) {
  const response = new EventEmitter() as EventEmitter & Record<string, any>;
  response.writeHead = () => undefined;
  response.flushHeaders = () => undefined;
  response.write = () => true;
  response.end = () => response.emit('close');
  streamCanvas({} as IncomingMessage, response as unknown as ServerResponse, store);
}
await new Promise((resolve) => setTimeout(resolve, 2100));
const cpu = process.cpuUsage(start);
closeCanvasStreams(store);
await rm(root, { recursive: true, force: true });
console.log(JSON.stringify({ reads, cpuMs: (cpu.user + cpu.system) / 1000, clients: 4, elements: 1000 }));
