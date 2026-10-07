import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CanvasStore } from './store.js';
import { canvasToolSource } from './tools.js';
import { withCanvasChat } from './context.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('automatically creates one canvas per chat even when chats share cached tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-chat-'));
  roots.push(root);
  const store = new CanvasStore(root, '/canvas?project=demo', true);
  const tools = await canvasToolSource(store).tools();
  const options = { toolCallId: 'test', messages: [], context: undefined };
  expect(Object.keys(tools).sort()).toEqual(['canvas_add', 'canvas_clear', 'canvas_delete', 'canvas_get', 'canvas_layout', 'canvas_update']);

  const results = await Promise.all(['one', 'two'].map((id) => withCanvasChat(id, async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return tools.canvas_add!.execute!({ revision: 0, elements: [{ id, type: 'rectangle', text: id }] }, options);
  })));
  expect(results[0]).toMatchObject({ kind: 'canvas', chatId: 'one', url: '/canvas?project=demo&chat=one' });
  expect(results[1]).toMatchObject({ kind: 'canvas', chatId: 'two' });
  expect(results[0]).not.toHaveProperty('name');

  const restarted = new CanvasStore(root, '/canvas?project=demo', true);
  expect(restarted.describe(await restarted.forChat('one').current()).elements.map((e) => e.id)).toEqual(['one']);
  expect(restarted.describe(await restarted.forChat('two').current()).elements.map((e) => e.id)).toEqual(['two']);
  await expect(restarted.forChat('new').current()).rejects.toThrow(/not found/);
});

it('reads manual edits from the same chat and prevents selecting another canvas', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-chat-'));
  roots.push(root);
  const store = new CanvasStore(root, '/canvas', true);
  const scoped = store.forChat('one');
  await scoped.ensure();
  const scene = await scoped.change('add', { elements: [{ id: 'api', type: 'rectangle', text: 'API' }] });
  scene.elements[0]!.x = 900;
  await scoped.saveBrowser(scene);
  const tools = await canvasToolSource(store).tools();
  const options = { toolCallId: 'test', messages: [], context: undefined };
  const result = await withCanvasChat('one', () => tools.canvas_get!.execute!({}, options));
  expect(result).toMatchObject({ elements: [expect.objectContaining({ id: 'api', x: 900 })] });
  await expect(scoped.current('chat-two')).rejects.toThrow(/chat/);
  await expect(store.forChat('two').saveBrowser(scene)).rejects.toThrow();
  expect(await withCanvasChat(undefined, () => tools.canvas_add!.execute!({ elements: [{ type: 'rectangle' }] }, options)))
    .toMatchObject({ error: expect.stringContaining('chat') });
  expect(() => store.forChat('../escape')).toThrow(/chat/);
});

it('branches a drawing once without sharing subsequent edits or overwriting the child', async () => {
  const { forkChatCanvas } = await import('./fork.js');
  const root = await mkdtemp(join(tmpdir(), 'canvas-branch-'));
  roots.push(root);
  const store = new CanvasStore(root, '/canvas', true);
  await store.forChat('parent').ensure();
  await store.forChat('parent').change('add', { elements: [{ id: 'api', type: 'rectangle', text: 'API' }] });
  await forkChatCanvas(store, 'child', 'parent');
  await store.forChat('child').change('update', { elements: [{ id: 'api', text: 'Child API' }] });
  await forkChatCanvas(store, 'child', 'parent');

  expect(store.describe(await store.forChat('child').current()).elements[0]!.text).toBe('Child API');
  expect(store.describe(await store.forChat('parent').current()).elements[0]!.text).toBe('API');
});
