import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CanvasStore } from './store.js';
import { canvasToolSource } from './tools.js';
import { canvasFromEnv } from './config.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('registers only when opted in and fails safely if disabled during a turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-tools-'));
  roots.push(root);
  const store = new CanvasStore(root, '/canvas');
  const source = canvasToolSource(store);
  expect(await source.tools()).toEqual({});

  await store.configure(true);
  const tools = await source.tools();
  expect(Object.keys(tools)).toHaveLength(6);
  const execute = tools.canvas_add!.execute!;
  expect(await execute({ elements: [{ type: 'rectangle' }] }, { toolCallId: 'test', messages: [], context: undefined })).toMatchObject({ kind: 'canvas', url: expect.stringContaining('/canvas?chat=') });

  await store.configure(false);
  expect(await execute({ elements: [{ type: 'rectangle' }] }, { toolCallId: 'test', messages: [], context: undefined })).toMatchObject({ error: expect.stringContaining('disabled') });
});

it('uses project storage and the configured local web port', () => {
  const store = canvasFromEnv({ CODEBERG_HOME: '/data', CODEBERG_PROJECT_HOME: '/data/projects/a',
    CODEBERG_PROJECT_ID: 'a', CODEBERG_WEB_PORT: '3210' });

  expect(store.root).toBe('/data/projects/a/canvas');
  expect(store.url).toBe('http://127.0.0.1:3210/canvas?project=a');
});
