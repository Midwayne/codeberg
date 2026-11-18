import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CanvasStore } from './store.js';
import type { Element, Scene } from './types.js';

let root: string;
let store: CanvasStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'canvas-excalidraw-'));
  store = new CanvasStore(root, '/canvas', true);
  await store.create('full');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const find = (scene: Scene, id: string): Element => scene.elements.find((element) => element.id === id)!;

it('maps typography, look and editor properties to Excalidraw fields', async () => {
  const scene = await store.change('add', { elements: [
    { id: 'box', type: 'rectangle', text: 'Box', fontFamily: 'nunito', textAlign: 'left', verticalAlign: 'top',
      roughness: 0, opacity: 40, angle: 90, roundness: 'sharp', fillStyle: 'zigzag', groupIds: ['cluster'], locked: true },
    { id: 'note', type: 'text', text: 'Code', fontFamily: 'comic-shanns' },
  ] });
  const box = find(scene, 'box');
  const label = find(scene, 'box__label');

  expect(box).toMatchObject({ roughness: 0, opacity: 40, roundness: null, fillStyle: 'zigzag', groupIds: ['cluster'], locked: true });
  expect(box.angle).toBeCloseTo(Math.PI / 2);
  expect(label).toMatchObject({ fontFamily: 6, textAlign: 'left', verticalAlign: 'top' });
  expect(label.x).toBeLessThan(box.x + 20);
  expect(find(scene, 'note').fontFamily).toBe(8);
  await expect(store.change('add', { elements: [{ type: 'text', text: 'x', fontFamily: 'comic' }] })).rejects.toThrow(/font/);
});

it('routes elbow and curved arrows and keeps ER arrowheads', async () => {
  await store.change('add', { elements: [
    { id: 'a', type: 'rectangle', x: 0, y: 0 }, { id: 'b', type: 'rectangle', x: 500, y: 300 },
    { id: 'elbow', type: 'arrow', from: 'a', to: 'b', arrowType: 'elbow', text: 'calls' },
    { id: 'curve', type: 'arrow', from: 'b', to: 'a', arrowType: 'curved', startArrowhead: 'crowfoot_many', endArrowhead: 'crowfoot_one' },
  ] });
  const scene = await store.change('update', { elements: [{ id: 'b', x: 600 }] });
  const elbow = find(scene, 'elbow');
  const points = elbow.points as number[][];

  expect(points).toHaveLength(4);
  expect(points[1]![1]).toBe(points[0]![1]);
  expect(points[2]![0]).toBe(points[1]![0]);
  expect(elbow.x + points[3]![0]!).toBeLessThan(600);
  expect(find(scene, 'curve')).toMatchObject({ roundness: { type: 2 }, startArrowhead: 'crowfoot_many', endArrowhead: 'crowfoot_one' });
  expect((find(scene, 'curve').points as number[][])).toHaveLength(3);
});

it('draws custom polygons, freedraw strokes, SVG images and frames', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12"><circle cx="6" cy="6" r="5"/></svg>';
  let scene = await store.change('add', { elements: [
    { id: 'tri', type: 'line', x: 10, y: 10, points: [[0, 0], [100, 0], [50, 80]], closed: true, backgroundColor: '#ffc9c9' },
    { id: 'mark', type: 'freedraw', x: 0, y: 200, points: [[0, 0], [10, 5], [20, 0]] },
    { id: 'icon', type: 'image', svg },
    { id: 'view', type: 'frame', text: 'Overview' },
    { id: 'inside', type: 'rectangle', text: 'Inside', group: 'view', x: 400, y: 400 },
  ] });

  expect(find(scene, 'tri').points).toEqual([[0, 0], [100, 0], [50, 80], [0, 0]]);
  expect(find(scene, 'mark')).toMatchObject({ simulatePressure: true, width: 20 });
  expect(find(scene, 'icon')).toMatchObject({ status: 'saved', width: 120, height: 60 });
  expect(Object.keys(scene.files)).toEqual([find(scene, 'icon').fileId]);
  expect(find(scene, 'view')).toMatchObject({ name: 'Overview' });
  expect(find(scene, 'inside').frameId).toBe('view');
  expect(find(scene, 'inside__label').frameId).toBe('view');
  expect(find(scene, 'view').x).toBeLessThan(400);

  scene = await store.change('delete', { ids: ['icon', 'view'] });
  expect(scene.files).toEqual({});
  expect(find(scene, 'inside').frameId).toBeNull();
  await expect(store.change('add', { elements: [{ type: 'image', svg: '<svg><script>x</script></svg>' }] })).rejects.toThrow(/svg/);
});

it('sets the scene look, restyles existing elements and applies defaults to new ones', async () => {
  await store.change('add', { elements: [{ id: 'old', type: 'rectangle', text: 'Old' }] });
  await store.change('scene', { scene: { roughness: 0, fontFamily: 'nunito', roundness: 'sharp', background: '#f8f9fa', grid: true } });
  const scene = await store.change('add', { elements: [{ id: 'new', type: 'diamond', text: 'New' }] });

  expect(scene.appState).toMatchObject({ viewBackgroundColor: '#f8f9fa', gridModeEnabled: true,
    currentItemRoughness: 0, currentItemFontFamily: 6, currentItemRoundness: 'sharp' });
  expect(find(scene, 'old')).toMatchObject({ roughness: 0, roundness: null });
  expect(find(scene, 'old__label').fontFamily).toBe(6);
  expect(find(scene, 'new')).toMatchObject({ roughness: 0, roundness: null });
  expect(find(scene, 'new__label').fontFamily).toBe(6);
  expect(store.describe(scene).scene).toMatchObject({ currentItemRoughness: 0 });
  await expect(store.change('scene', { scene: {} })).rejects.toThrow(/setting/);
});

it('keeps arrow routing after browser edits', async () => {
  const base = await store.change('add', { elements: [
    { id: 'a', type: 'rectangle', x: 0, y: 0 }, { id: 'b', type: 'rectangle', x: 500, y: 300 },
    { id: 'link', type: 'arrow', from: 'a', to: 'b', arrowType: 'elbow' },
  ] });
  await store.saveBrowser(structuredClone(base));
  const scene = await store.change('update', { elements: [{ id: 'a', y: 50 }] });

  expect(find(scene, 'link').points as number[][]).toHaveLength(4);
});
