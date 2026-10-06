import { makeElement, bump, setLabel } from './elements.js';
import { reconnect } from './connections.js';
import { CanvasError, type Element, type Mutation, type Scene } from './types.js';

export function mutate(scene: Scene, operation: string, input: Mutation): void {
  switch (operation) {
    case 'add':
      add(scene, input);
      break;
    case 'update':
      update(scene, input);
      break;
    case 'delete':
      remove(scene, input.ids ?? []);
      break;
    case 'clear':
      scene.elements = [];
      break;
    case 'layout':
      layout(scene, input.mode ?? 'flow');
      break;
    default: throw new CanvasError('Unknown canvas operation.');
  }
  reconnect(scene.elements);
}

function add(scene: Scene, input: Mutation): void {
  if (!input.elements?.length) throw new CanvasError('elements are required.');

  const labels: { element: Element; text: string }[] = [];
  for (const item of input.elements) {
    const element = makeElement(item, scene.elements.filter((element) => !element.containerId).length);
    if (scene.elements.some((existing) => existing.id === element.id)) throw new CanvasError(`Element already exists: ${element.id}`);

    scene.elements.push(element);
    if (item.text !== undefined && element.type !== 'text') labels.push({ element, text: item.text });
  }
  for (const { element, text } of labels) setLabel(scene.elements, element, text);
}

function update(scene: Scene, input: Mutation): void {
  if (!input.elements?.length) throw new CanvasError('elements are required.');

  for (const item of input.elements) {
    const element = scene.elements.find((element) => element.id === item.id && !element.isDeleted);
    if (!element) throw new CanvasError(`Unknown element: ${item.id}`);

    for (const key of ['x', 'y', 'width', 'height', 'strokeColor', 'backgroundColor'] as const) {
      if (item[key] !== undefined) Object.assign(element, { [key]: item[key] });
    }
    if (item.from || item.to) {
      element.customData = { codeberg: {
        from: item.from ?? element.startBinding?.elementId, to: item.to ?? element.endBinding?.elementId,
      } };
    }
    if (item.text !== undefined) setLabel(scene.elements, element, item.text);

    bump(element);
  }
}

function remove(scene: Scene, ids: string[]): void {
  const removed = new Set(ids);
  for (const element of scene.elements) {
    if (removed.has(element.startBinding?.elementId ?? '') || removed.has(element.endBinding?.elementId ?? '')) {
      removed.add(element.id);
    }
  }
  for (const element of scene.elements) {
    if (removed.has(element.id) || removed.has(element.containerId ?? '')) {
      element.isDeleted = true;
      bump(element);
    }
  }
}

function layout(scene: Scene, mode: string): void {
  if (!['horizontal', 'vertical', 'flow'].includes(mode)) throw new CanvasError('Invalid layout mode.');

  const nodes = scene.elements.filter((element) => !element.isDeleted && !element.containerId && !['arrow', 'line'].includes(element.type));
  const levels = graphLevels(nodes, scene.elements);
  const rows = new Map<number, number>();
  nodes.forEach((node, index) => {
    const column = mode === 'flow' ? levels.get(node.id)! : index;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    node.x = 100 + (mode === 'vertical' ? 0 : column * 320);
    node.y = 100 + (mode === 'vertical' ? index * 180 : row * 180);
    bump(node);
  });
}

function graphLevels(nodes: Element[], elements: Element[]): Map<string, number> {
  const levels = new Map(nodes.map((node) => [node.id, 0]));
  // Bounded relaxation handles disconnected components and cycles deterministically.
  for (let pass = 0; pass < nodes.length; pass++) {
    for (const arrow of elements.filter((element) => element.type === 'arrow' && !element.isDeleted)) {
      const from = arrow.startBinding?.elementId;
      const to = arrow.endBinding?.elementId;
      if (from && to && levels.has(from) && levels.has(to)) {
        levels.set(to, Math.min(nodes.length - 1, Math.max(levels.get(to)!, levels.get(from)! + 1)));
      }
    }
  }
  return levels;
}
