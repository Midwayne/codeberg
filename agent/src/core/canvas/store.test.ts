import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as storage from './storage.js';
import { CanvasStore } from './store.js';

let root: string;
let store: CanvasStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'codeberg-canvas-'));
  store = new CanvasStore(root, '/canvas');
  await store.configure(true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it('creates portable scenes, persists and reopens after restart', async () => {
  await store.create('architecture');
  const scene = await store.change('add', { elements: [{ id: 'api', type: 'rectangle', text: 'API' }] });
  const saved = JSON.parse(await readFile(join(root, 'architecture.excalidraw'), 'utf8'));

  expect(saved.type).toBe('excalidraw');
  expect(saved.elements.find((element: { id: string }) => element.id === 'api')).toBeDefined();
  expect(await new CanvasStore(root, '/canvas').current()).toEqual(scene);
  expect((await store.list())[0]).toMatchObject({ name: 'architecture', elementCount: 2 });
});

it('preserves semantic IDs, bound labels and arrow relationships through edits and layout', async () => {
  await store.create('flow');
  await store.change('add', { elements: [
    { id: 'api', type: 'rectangle', text: 'API' },
    { id: 'db', type: 'ellipse', text: 'Database' },
    { id: 'request', type: 'arrow', from: 'api', to: 'db', text: 'query' },
  ] });
  await store.change('update', { elements: [{ id: 'db', text: 'Storage' }] });
  const scene = await store.change('layout', { mode: 'vertical' });
  const arrow = scene.elements.find((element) => element.id === 'request')!;

  expect(arrow.startBinding).toMatchObject({ elementId: 'api' });
  expect(arrow.endBinding).toMatchObject({ elementId: 'db' });
  expect(store.describe(scene).elements.find((element) => element.id === 'db')?.text).toBe('Storage');
  expect(scene.elements.find((element) => element.id === 'db')!.y).toBeGreaterThan(100);

  await store.change('delete', { ids: ['db'] });
  expect(store.describe(await store.current()).elements.some((element) => element.id === 'request')).toBe(false);
  await store.change('clear', {});
  expect((await store.current()).elements).toEqual([]);
});

it('rejects stale revisions, concurrent writes, malformed scenes and disabled operations', async () => {
  const scene = await store.create('revision');
  await store.change('add', { revision: scene.revision, elements: [{ id: 'a', type: 'text', text: 'A' }] });
  await expect(store.change('clear', { revision: scene.revision })).rejects.toThrow(/revision/i);
  await expect(store.saveBrowser({ ...await store.current(), elements: [{}] })).rejects.toThrow(/element/i);
  await expect(store.change('add', { elements: [{ id: 'broken', type: 'arrow', from: 'missing', to: 'a' }] })).rejects.toThrow();

  const revision = (await store.current()).revision;
  const other = new CanvasStore(root, '/canvas');
  const results = await Promise.allSettled([
    store.change('clear', { revision }), other.change('clear', { revision }),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

  await store.configure(false);
  await expect(store.change('clear', {})).rejects.toThrow(/disabled/i);
});

it('reflects browser renames, moves, notes, deletions and files', async () => {
  await store.create('manual');
  const base = await store.change('add', { elements: [{ id: 'api', type: 'rectangle', text: 'API' }] });
  const edited = structuredClone(base);
  edited.elements[0]!.x = 900;
  edited.elements.find((element) => element.type === 'text')!.text = 'User API';
  await store.saveBrowser(edited);

  expect(store.describe(await store.current()).elements[0]).toMatchObject({ id: 'api', x: 900, text: 'User API' });
  await expect(store.saveBrowser(base)).rejects.toThrow(/revision/i);
});

it('rejects path traversal and corrupted persisted scenes without overwriting them', async () => {
  for (const name of ['../escape', '/absolute', '..', 'a/b', 'index', 'settings']) {
    await expect(store.create(name)).rejects.toThrow(/name/i);
  }
  await store.create('corrupt');
  await writeFile(join(root, 'corrupt.excalidraw'), '{oops');
  await expect(store.current()).rejects.toThrow();
  expect(await readFile(join(root, 'corrupt.excalidraw'), 'utf8')).toBe('{oops');
});

it('keeps the authoritative revision and scene after a failed disk write', async () => {
  const before = await store.create('disk-failure');
  vi.spyOn(storage, 'atomicWrite').mockRejectedValueOnce(new Error('Disk full'));
  await expect(store.change('add', { elements: [{ id: 'api', type: 'rectangle' }] })).rejects.toThrow('Disk full');

  expect(await store.current()).toEqual(before);
});

it('creates every supported shape and rejects malformed linear geometry', async () => {
  await store.create('shapes');
  const scene = await store.change('add', { elements: [
    { id: 'rect', type: 'rectangle' }, { id: 'ellipse', type: 'ellipse' },
    { id: 'diamond', type: 'diamond' }, { id: 'text', type: 'text', text: 'Note' },
    { id: 'line', type: 'line', width: 100, height: 50 },
    { id: 'arrow', type: 'arrow', from: 'rect', to: 'ellipse', text: 'Request' },
  ] });
  expect(scene.elements.find((element) => element.id === 'line')!.points).toEqual([[0, 0], [100, 50]]);
  expect(scene.elements.find((element) => element.id === 'arrow')!.endArrowhead).toBe('arrow');

  const malformed = structuredClone(scene);
  malformed.elements.find((element) => element.id === 'line')!.points = [['bad', 0]];
  await expect(store.saveBrowser(malformed)).rejects.toThrow(/points/);
});

it('sizes vertical arrow labels along the connection rather than its zero horizontal width', async () => {
  await store.create('vertical-label');
  const scene = await store.change('add', { elements: [
    { id: 'source', type: 'rectangle', x: 100, y: 100 },
    { id: 'target', type: 'rectangle', x: 100, y: 300 },
    { id: 'save', type: 'arrow', from: 'source', to: 'target', text: 'Auto-save' },
  ] });
  const label = scene.elements.find((element) => element.containerId === 'save')!;
  expect(label.text).toBe('Auto-save');
  expect(label.width).toBeGreaterThanOrEqual(72);
});
