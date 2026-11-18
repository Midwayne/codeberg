import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CanvasStore } from './store.js';
import { findIssues } from './issues.js';
import type { Element, Scene } from './types.js';

let root: string;
let store: CanvasStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'canvas-design-'));
  store = new CanvasStore(root, '/canvas', true);
  await store.create('design');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const find = (scene: Scene, id: string): Element => scene.elements.find((element) => element.id === id)!;

it('styles shapes by semantic role and lets explicit properties override', async () => {
  const scene = await store.change('add', { elements: [
    { id: 'db', role: 'datastore', text: 'Postgres' },
    { id: 'ext', role: 'external', text: 'Stripe', backgroundColor: '#ffffff' },
    { id: 'title', role: 'title', text: 'Checkout' },
  ] });

  expect(find(scene, 'db')).toMatchObject({ type: 'ellipse', strokeColor: '#2b8a3e', backgroundColor: '#d3f9d8' });
  expect(find(scene, 'ext')).toMatchObject({ type: 'rectangle', strokeStyle: 'dashed', backgroundColor: '#ffffff' });
  expect(find(scene, 'title')).toMatchObject({ type: 'text', fontSize: 32 });
  expect(find(scene, 'db__label').strokeColor).toBe('#2b8a3e');
  await expect(store.change('add', { elements: [{ role: 'bogus' }] })).rejects.toThrow(/role/);
});

it('sizes shapes to fit their labels and places unpositioned shapes side by side', async () => {
  const text = 'Inventory reservation service with retries';
  const scene = await store.change('add', { elements: [
    { id: 'long', type: 'rectangle', text }, { id: 'next', type: 'rectangle', text: 'B' },
  ] });
  const long = find(scene, 'long');

  expect(long.width).toBeGreaterThan(220);
  expect(find(scene, 'next').x).toBeGreaterThanOrEqual(long.x + long.width);
  expect(findIssues(scene.elements)).toEqual([]);
});

it('fits boundaries around members, behind them, and reports issues', async () => {
  let scene = await store.change('add', { elements: [
    { id: 'core', role: 'boundary', text: 'Core' },
    { id: 'a', role: 'service', text: 'A', group: 'core', x: 400, y: 300 },
    { id: 'b', role: 'service', text: 'B', group: 'core', x: 700, y: 300 },
  ] });
  const core = find(scene, 'core');

  expect(scene.elements.indexOf(core)).toBe(0);
  expect(core.x).toBeLessThan(400);
  expect(core.x + core.width).toBeGreaterThan(700 + find(scene, 'b').width);
  expect(find(scene, 'core__label')).toMatchObject({ verticalAlign: 'top', textAlign: 'left' });

  scene = await store.change('add', { elements: [
    { id: 'stray', role: 'step', text: 'Stray', x: 410, y: 310 },
    { id: 'tiny', type: 'rectangle', text: 'A very long label that cannot fit', width: 60, height: 30 },
  ] });
  const kinds = findIssues(scene.elements).map((issue) => issue.kind);
  expect(kinds).toEqual(expect.arrayContaining(['overlap', 'text-overflow', 'outside-group']));
  expect(store.describe(scene).issues.length).toBeGreaterThan(0);
});

it('lays out flows in size-aware layers without overlaps and titles above', async () => {
  await store.change('add', { elements: [
    { id: 'title', role: 'title', text: 'Request path' },
    { id: 'api', group: 'edge', role: 'service', text: 'API gateway' },
    { id: 'edge', role: 'boundary', text: 'Edge' },
    { id: 'auth', role: 'service', text: 'Authentication and session validation' },
    { id: 'orders', role: 'service', text: 'Orders' },
    { id: 'db', role: 'datastore', text: 'Orders DB' },
    { id: 'a1', type: 'arrow', from: 'api', to: 'auth' },
    { id: 'a2', type: 'arrow', from: 'api', to: 'orders' },
    { id: 'a3', type: 'arrow', from: 'orders', to: 'db', text: 'SQL' },
    { id: 'a4', type: 'arrow', from: 'db', to: 'api' },
  ] });
  const scene = await store.change('layout', { mode: 'flow' });

  expect(find(scene, 'auth').x).toBeGreaterThan(find(scene, 'api').x + find(scene, 'api').width);
  expect(find(scene, 'db').x).toBeGreaterThan(find(scene, 'orders').x + find(scene, 'orders').width);
  expect(find(scene, 'title').y + find(scene, 'title').height).toBeLessThan(find(scene, 'edge').y);
  expect(findIssues(scene.elements)).toEqual([]);

  const down = await store.change('layout', { mode: 'flow-down' });
  expect(find(down, 'db').y).toBeGreaterThan(find(down, 'orders').y + find(down, 'orders').height);
  expect(findIssues(down.elements)).toEqual([]);
});

it('restyles and regroups elements on update', async () => {
  await store.change('add', { elements: [
    { id: 'g', role: 'boundary', text: 'G' }, { id: 'x', type: 'rectangle', text: 'X' },
  ] });
  const scene = await store.change('update', { elements: [{ id: 'x', role: 'error', group: 'g', strokeStyle: 'dotted' }] });

  expect(find(scene, 'x')).toMatchObject({ backgroundColor: '#ffe3e3', strokeStyle: 'dotted' });
  expect(store.describe(scene).elements.find((element) => element.id === 'x')).toMatchObject({ role: 'error', group: 'g' });
  expect(findIssues(scene.elements)).toEqual([]);
});
