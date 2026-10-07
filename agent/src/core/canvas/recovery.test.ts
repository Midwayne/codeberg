import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ToolSet } from 'ai';
import { CanvasStore } from './store.js';
import { withCanvasChat } from './context.js';
import { canvasToolSource } from './tools.js';
import { canvasSchemas } from './schemas.js';
import type { Mutation } from './types.js';

let root: string;
let store: CanvasStore;
let tools: ToolSet;
const options = { toolCallId: 'test', messages: [], context: undefined };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'canvas-recovery-'));
  const base = new CanvasStore(root, '/canvas', true);
  store = base.forChat('one');
  tools = await canvasToolSource(base).tools();
  await store.ensure();
  await store.change('add', { elements: [{ id: 'api', type: 'rectangle', text: 'API' }] });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function call(operation: string, input: Mutation = {}) {
  return tools[`canvas_${operation}`]!.execute!(input, options);
}

async function userEdit(text: string, x: number) {
  const scene = await store.current();
  scene.elements.find((element) => element.id === 'api')!.x = x;
  scene.elements.find((element) => element.containerId === 'api')!.text = text;
  await store.saveBrowser(scene);
}

it('rejects a second user edit during recovery and applies a rebuilt patch without losing either edit', async () => {
  await withCanvasChat('one', async () => {
    const patch = { elements: [{ id: 'api', backgroundColor: '#d3f9d8' }] };
    await userEdit('User API', 500);
    expect(await call('update', { revision: 1, ...patch })).toMatchObject({
      code: 'CANVAS_REVISION_CONFLICT', expectedRevision: 1, currentRevision: 2,
      retryable: true, applied: false, recovery: expect.stringContaining('canvas_get'),
    });
    const read = await call('get');
    expect(read).toMatchObject({ revision: 2, elements: [expect.objectContaining({ text: 'User API', x: 500 })] });

    await userEdit('Latest user API', 900);
    expect(await call('update', { revision: 2, ...patch })).toMatchObject({ currentRevision: 3, retryable: true });
    expect(await call('get')).toMatchObject({ revision: 3 });
    expect(await call('update', { revision: 3, ...patch })).toMatchObject({ revision: 4 });

    expect(store.describe(await store.current()).elements[0]).toMatchObject({
      text: 'Latest user API', x: 900, backgroundColor: '#d3f9d8',
    });
  });
});

it('stops writes after three conflicts despite rereads, then allows recovery on the next turn', async () => {
  await withCanvasChat('one', async () => {
    for (let revision = 1; revision <= 3; revision++) {
      await userEdit(`User ${revision}`, revision * 100);
      expect(await call('clear', { revision })).toMatchObject({
        code: 'CANVAS_REVISION_CONFLICT', retryable: revision < 3, applied: false,
      });
      await call('get');
    }

    expect(await call('clear', { revision: 4 })).toMatchObject({ code: 'CANVAS_RETRY_LIMIT', retryable: false });
    expect((await store.current()).revision).toBe(4);
  });

  await withCanvasChat('one', async () => {
    expect(await call('update', { revision: 4, elements: [{ id: 'api', backgroundColor: '#d0ebff' }] }))
      .toMatchObject({ revision: 5 });
  });
});

it.each(['add', 'update', 'delete', 'clear', 'layout'])('requires a valid revision for agent %s', async (operation) => {
  expect(canvasSchemas(operation).required).toContain('revision');

  await withCanvasChat('one', async () => {
    for (const revision of [undefined, -1, 1.5, NaN, '1', null]) {
      expect(await call(operation, { revision } as Mutation)).toMatchObject({ code: 'CANVAS_REVISION_REQUIRED' });
    }
  });
  expect((await store.current()).revision).toBe(1);
});

it('does not treat disabled tools or validation failures as retryable conflicts', async () => {
  await withCanvasChat('one', async () => {
    expect(await call('update', { revision: 1, elements: [{ id: 'missing', text: 'Missing' }] }))
      .not.toHaveProperty('retryable', true);
    await store.configure(false);
    expect(await call('clear', { revision: 1 })).toMatchObject({ error: expect.stringContaining('disabled') });
  });
});

it('isolates the conflict budget when pooled tools serve concurrent chats', async () => {
  const other = new CanvasStore(root, '/canvas', true).forChat('two');
  await other.ensure();

  const results = await Promise.all([
    withCanvasChat('one', async () => {
      for (let attempt = 0; attempt < 3; attempt++) await call('clear', { revision: 0 });

      return call('clear', { revision: 1 });
    }),
    withCanvasChat('two', () => call('add', { revision: 0, elements: [{ id: 'db', type: 'ellipse' }] })),
  ]);

  expect(results[0]).toMatchObject({ code: 'CANVAS_RETRY_LIMIT' });
  expect(results[1]).toMatchObject({ chatId: 'two', revision: 1 });
  expect((await store.current()).revision).toBe(1);
});

it('keeps earlier successful writes and rejects stale changes to a target the user deleted', async () => {
  await withCanvasChat('one', async () => {
    expect(await call('add', { revision: 1, elements: [{ id: 'db', type: 'ellipse', text: 'Database' }] }))
      .toMatchObject({ revision: 2 });
    const scene = await store.current();
    for (const element of scene.elements) {
      if (element.id === 'api' || element.containerId === 'api') element.isDeleted = true;
    }
    await store.saveBrowser(scene);

    expect(await call('update', { revision: 2, elements: [{ id: 'api', text: 'Old API' }] }))
      .toMatchObject({ code: 'CANVAS_REVISION_CONFLICT', applied: false });
    expect(await call('get')).toMatchObject({ revision: 3, elements: [expect.objectContaining({ id: 'db' })] });
    expect(await call('update', { revision: 3, elements: [{ id: 'db', text: 'Changed' }, { id: 'api', text: 'Old API' }] }))
      .toMatchObject({ error: expect.stringContaining('Unknown element') });

    const saved = store.describe(await store.current());
    expect(saved.revision).toBe(3);
    expect(saved.elements).toEqual([expect.objectContaining({ id: 'db', text: 'Database' })]);
  });
});
